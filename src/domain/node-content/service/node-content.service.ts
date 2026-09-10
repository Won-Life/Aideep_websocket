import {
  BadRequestException,
  Injectable,
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
