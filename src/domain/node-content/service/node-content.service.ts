import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  ConflictException,
  UnprocessableEntityException
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { RedisService } from '@global/redis/redis.service';
import { REDIS_KEYS } from '@global/redis/redis.keys';
import { YjsDocManager } from '@global/yjs/yjs-doc-manager';
import { WsGateway } from '@domain/ws/controller/ws.gateway';
import { MembershipRepository } from '@domain/membership/repository/membership.repository';
import { NodeContentRepository } from '../repository/node-content.repository';
import { NodeBodyPatchPayload } from '@domain/event-bus/type/event-bus.contract';
import {
  NodeContentOperationBody,
  NodeContentOperationResponse
} from '../dto/nodeContentOperation.dto';

/**
 * Aideep_backend/src/node/node.service.ts 의 executeContentOperation을 그대로 옮긴 서비스입니다.
 * Y.Doc을 메모리에 들고 있는 프로세스만 CRDT 문서를 안전하게 변형할 수 있으므로 실시간 서버에 둡니다.
 */
@Injectable()
export class NodeContentService {
  private readonly logger = new Logger(NodeContentService.name);

  constructor(
    private readonly nodeContentRepository: NodeContentRepository,
    private readonly membershipRepository: MembershipRepository,
    private readonly redisService: RedisService,
    private readonly wsGateway: WsGateway,
    private readonly yjsDocManager: YjsDocManager
  ) {}

  async executeContentOperation(
    userId: string,
    workspaceId: string,
    nodeId: string,
    idempotencyKey: string,
    body: NodeContentOperationBody
  ): Promise<NodeContentOperationResponse> {
    if (
      !idempotencyKey ||
      idempotencyKey.length < 8 ||
      idempotencyKey.length > 128
    ) {
      throw new BadRequestException({ code: 'INVALID_IDEMPOTENCY_KEY' });
    }
    if (!body.markdown.trim()) {
      throw new BadRequestException({ code: 'EMPTY_MARKDOWN' });
    }

    await this.checkEditPermission(userId, workspaceId);
    const existing = await this.nodeContentRepository.selectNodeById(
      workspaceId,
      nodeId
    );
    if (!existing) throw new NotFoundException({ code: 'NODE_NOT_FOUND' });
    const content = (existing.content as Record<string, unknown>) ?? {};
    if (content.dataType !== 'MARKDOWN') {
      throw new UnprocessableEntityException({
        code: 'NODE_TYPE_NOT_EDITABLE'
      });
    }

    const requestHash = createHash('sha256')
      .update(JSON.stringify(body))
      .digest('hex');
    const cacheKey = REDIS_KEYS.NODE_CONTENT_OPERATION(
      workspaceId,
      nodeId,
      userId,
      idempotencyKey
    );
    const cachedRaw = await this.redisService.getClient().get(cacheKey);
    if (typeof cachedRaw === 'string') {
      const cached = JSON.parse(cachedRaw) as {
        requestHash: string;
        state?: 'IN_PROGRESS';
        response?: NodeContentOperationResponse;
      };
      if (cached.requestHash !== requestHash) {
        throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED' });
      }
      if (cached.state === 'IN_PROGRESS' || !cached.response) {
        throw new ConflictException({ code: 'OPERATION_IN_PROGRESS' });
      }
      return { ...cached.response, duplicate: true };
    }

    if (
      body.expectedVersion !== undefined &&
      body.expectedVersion !== existing.version
    ) {
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        currentVersion: existing.version
      });
    }

    const claimed = await this.redisService
      .getClient()
      .set(cacheKey, JSON.stringify({ requestHash, state: 'IN_PROGRESS' }), {
        EX: 60,
        NX: true
      });
    if (claimed !== 'OK') {
      throw new ConflictException({ code: 'OPERATION_IN_PROGRESS' });
    }

    let persisted: Awaited<ReturnType<YjsDocManager['appendMarkdown']>>;
    try {
      persisted = await this.yjsDocManager.appendMarkdown(
        nodeId,
        workspaceId,
        body.markdown,
        userId
      );
    } catch (error) {
      await this.redisService.getClient().del(cacheKey);
      throw error;
    }
    this.wsGateway.broadcastYjsUpdate(nodeId, persisted.update);

    const response: NodeContentOperationResponse = {
      operationId: randomUUID(),
      nodeId,
      operation: body.operation,
      previousVersion: existing.version,
      version: persisted.version,
      updatedAt: persisted.updatedAt,
      duplicate: false
    };
    await this.redisService
      .getClient()
      .set(cacheKey, JSON.stringify({ requestHash, response }), { EX: 86_400 });
    return response;
  }

  /**
   * 이벤트 버스로 받은 NODE_BODY_PATCH를 적용합니다. HTTP 경로와 달리 요청한 사용자가 없고
   * 호출자가 API 서버(system:ai)이므로 멤버십/role 검사를 하지 않습니다.
   *
   * Pub/Sub은 재배달이 없어 실패하면 본문만 빠진 상태로 남습니다. 되돌릴 수 있는 것이 없으므로
   * 예외를 올리지 않고 기록만 남깁니다. commandEventId로 같은 명령의 중복 적용만 막습니다.
   */
  async applyNodeBodyPatch(payload: NodeBodyPatchPayload): Promise<void> {
    const { workspaceId, nodeId, markdown, actorId, commandEventId } = payload;
    if (!markdown?.trim() || !commandEventId) {
      this.logger.warn(
        `Skipped node body patch without markdown or commandEventId. nodeId=${nodeId}`
      );
      return;
    }

    const existing = await this.nodeContentRepository.selectNodeById(
      workspaceId,
      nodeId
    );
    if (!existing) {
      this.logger.warn(`Node not found for body patch. nodeId=${nodeId}`);
      return;
    }
    const content = (existing.content as Record<string, unknown>) ?? {};
    if (content.dataType !== 'MARKDOWN') {
      this.logger.warn(
        `Node is not editable as markdown. nodeId=${nodeId} dataType=${String(content.dataType)}`
      );
      return;
    }

    const cacheKey = REDIS_KEYS.NODE_CONTENT_OPERATION(
      workspaceId,
      nodeId,
      actorId,
      commandEventId
    );
    const claimed = await this.redisService
      .getClient()
      .set(cacheKey, JSON.stringify({ state: 'APPLIED' }), {
        EX: 86_400,
        NX: true
      });
    if (claimed !== 'OK') {
      this.logger.log(
        `Node body patch already applied. nodeId=${nodeId} commandEventId=${commandEventId}`
      );
      return;
    }

    try {
      const persisted = await this.yjsDocManager.appendMarkdown(
        nodeId,
        workspaceId,
        markdown,
        actorId
      );
      this.wsGateway.broadcastYjsUpdate(nodeId, persisted.update);
      this.logger.log(
        `Applied node body patch. nodeId=${nodeId} version=${persisted.version}`
      );
    } catch (error) {
      // 적용에 실패했으면 claim을 풀어 같은 명령이 다시 오면 시도할 수 있게 한다.
      await this.redisService.getClient().del(cacheKey);
      this.logger.error(
        `Failed to apply node body patch. nodeId=${nodeId} commandEventId=${commandEventId}`,
        error
      );
    }
  }

  private async checkEditPermission(userId: string, workspaceId: string) {
    const checkWorkspace = await this.membershipRepository.checkWorkspace(
      userId,
      workspaceId
    );
    if (!checkWorkspace) {
      throw new NotFoundException(
        '해당 유저의 워크스페이스가 존재하지 않습니다.'
      );
    }
    if (checkWorkspace.role !== 'OWNER' && checkWorkspace.role !== 'EDITOR') {
      throw new UnauthorizedException('노드를 수정할 권한이 없습니다.');
    }
  }
}
