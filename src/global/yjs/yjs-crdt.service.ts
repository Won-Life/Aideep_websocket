import { Injectable } from '@nestjs/common';
import { PrismaService } from '@global/prisma/prisma.service';
import { RedisService } from '@global/redis/redis.service';
import { REDIS_KEYS } from '@global/redis/redis.keys';
import { Transactional } from '@global/prisma/transactional.decorator';
import { FileAttachmentService } from '@domain/file-attachment/service/file-attachment.service';
import { markdownToYjsUpdate } from './markdown-yjs';

/** flush 시점에 노드 row가 이미 삭제되어 있을 때 (NODE_DELETE 유실 등) */
export class NodeGoneError extends Error {
  constructor(nodeId: string) {
    super(`Node no longer exists: ${nodeId}`);
  }
}

@Injectable()
export class YjsCrdtService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly fileAttachmentService: FileAttachmentService
  ) {}

  // ── Redis 계층 ──────────────────────────────────────────────

  async loadFromRedis(nodeId: string): Promise<Buffer | null> {
    const data = await this.redis
      .getClient()
      .get(REDIS_KEYS.YJS_DOC(nodeId))
      .catch(() => null);

    if (!data || typeof data !== 'string') return null;
    return Buffer.from(data, 'base64');
  }

  async saveToRedis(nodeId: string, state: Buffer): Promise<void> {
    await this.redis
      .getClient()
      .set(REDIS_KEYS.YJS_DOC(nodeId), state.toString('base64'), {
        EX: 86_400
      }); // 24h TTL
  }

  async deleteFromRedis(nodeId: string): Promise<void> {
    await this.redis.getClient().del(REDIS_KEYS.YJS_DOC(nodeId));
  }

  // ── DB 계층 ─────────────────────────────────────────────────

  async loadFromDb(
    nodeId: string
  ): Promise<{ state: Buffer | null; workspaceId: string } | null> {
    const node = await this.prisma.client.nodes.findUnique({
      where: { node_id: nodeId },
      select: { yjs_state: true, content: true, workspace_id: true }
    });
    if (!node) return null;

    // yjs_state가 있으면 그대로 반환
    if (node.yjs_state) {
      return {
        state: Buffer.from(node.yjs_state),
        workspaceId: node.workspace_id
      };
    }

    // yjs_state가 없으면 기존 content.markdownBody로 부트스트랩 (lazy migration)
    const content = node.content as Record<string, any> | null;
    const markdownBody = content?.markdownBody;

    if (markdownBody && typeof markdownBody === 'string') {
      // markdownBody를 Lexical @lexical/yjs 바인딩 포맷으로 변환 (평문 삽입은 에디터가 못 읽음 — 이슈 #71)
      const state = Buffer.from(markdownToYjsUpdate(markdownBody));
      return { state, workspaceId: node.workspace_id };
    }

    return { state: null, workspaceId: node.workspace_id };
  }

  @Transactional()
  async saveToDb(
    nodeId: string,
    state: Buffer,
    markdownText: string,
    workspaceId: string
  ): Promise<{ version: number; updatedAt: Date }> {
    // 현재 content를 읽어서 markdownBody만 업데이트
    const node = await this.prisma.client.nodes.findUnique({
      where: { node_id: nodeId },
      select: { content: true }
    });

    if (!node) throw new NodeGoneError(nodeId);

    const currentContent = (node.content as Record<string, any>) ?? {};
    const updatedContent = { ...currentContent, markdownBody: markdownText };

    const updated = await this.prisma.client.nodes.update({
      where: { node_id: nodeId },
      data: {
        yjs_state: new Uint8Array(state),
        content: updatedContent,
        version: { increment: 1 },
        updated_at: new Date()
      }
    });

    await this.fileAttachmentService.syncNodeAttachments(
      nodeId,
      workspaceId,
      updatedContent
    );

    // workspace sync 캐시 무효화
    await this.redis
      .getClient()
      .del(REDIS_KEYS.WORKSPACE_SYNC(workspaceId))
      .catch(() => {});

    return { version: updated.version, updatedAt: updated.updated_at };
  }
}
