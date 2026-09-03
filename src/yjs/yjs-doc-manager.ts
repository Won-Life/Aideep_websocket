import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import * as Y from 'yjs';
import { NodeGoneError, YjsCrdtService } from './yjs-crdt.service';
import { EmbedQueueService } from 'src/redis/embed-queue.service';
import {
  DEBOUNCE_SAVE_MS,
  SAFETY_FLUSH_INTERVAL_MS,
  DOC_IDLE_TIMEOUT_MS
} from './yjs.constants';
import { appendMarkdownToYjsDoc, yjsDocToMarkdown } from './markdown-yjs';

interface ManagedDoc {
  doc: Y.Doc;
  clients: Set<string>;
  workspaceId: string;
  saveTimer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  lastActivity: number;
  /** 마지막 flush 이후 실제 편집이 있었는지 (세이프티 플러시의 불필요한 재임베딩 방지) */
  dirtyForEmbed: boolean;
  /** 재임베딩 job에 실어보낼, 마지막으로 편집한 사용자 */
  lastEditorUserId: string | null;
}

@Injectable()
export class YjsDocManager implements OnModuleDestroy {
  private readonly logger = new Logger(YjsDocManager.name);
  private readonly docs = new Map<string, ManagedDoc>();
  private readonly loading = new Map<string, Promise<Y.Doc>>();
  private readonly operations = new Map<string, Promise<unknown>>();

  private flushInterval: ReturnType<typeof setInterval>;

  constructor(
    private readonly crdtService: YjsCrdtService,
    private readonly embedQueueService: EmbedQueueService
  ) {
    this.flushInterval = setInterval(
      () => this.flushAll(),
      SAFETY_FLUSH_INTERVAL_MS
    );
  }

  // ── Doc 로드/생성 ────────────────────────────────────────────

  async getOrCreateDoc(nodeId: string, workspaceId: string): Promise<Y.Doc> {
    const existing = this.docs.get(nodeId);
    if (existing) {
      // idle timer 취소 (다시 활성화됨)
      if (existing.idleTimer) {
        clearTimeout(existing.idleTimer);
        existing.idleTimer = null;
      }
      return existing.doc;
    }

    // 동시 로드 방지: 이미 로딩 중이면 기다림
    const pending = this.loading.get(nodeId);
    if (pending) return pending;

    const promise = this.loadDoc(nodeId, workspaceId);
    this.loading.set(nodeId, promise);

    try {
      return await promise;
    } finally {
      this.loading.delete(nodeId);
    }
  }

  private async loadDoc(nodeId: string, workspaceId: string): Promise<Y.Doc> {
    const doc = new Y.Doc();

    // 1차: Redis
    let state = await this.crdtService.loadFromRedis(nodeId);

    // 2차: DB
    if (!state) {
      const dbResult = await this.crdtService.loadFromDb(nodeId);
      if (dbResult?.state) {
        state = dbResult.state;
        workspaceId = dbResult.workspaceId;
      }
    }

    if (state) {
      Y.applyUpdate(
        doc,
        new Uint8Array(state.buffer, state.byteOffset, state.byteLength)
      );
    }

    // Lexical CollaborationPlugin이 사용하는 'root' XmlText 타입 초기화 보장
    doc.get('root', Y.XmlText);

    this.docs.set(nodeId, {
      doc,
      clients: new Set(),
      workspaceId,
      saveTimer: null,
      idleTimer: null,
      lastActivity: Date.now(),
      dirtyForEmbed: false,
      lastEditorUserId: null
    });

    return doc;
  }

  // ── 클라이언트 관리 ──────────────────────────────────────────

  addClient(nodeId: string, socketId: string): void {
    const managed = this.docs.get(nodeId);
    if (!managed) return;
    managed.clients.add(socketId);
    managed.lastActivity = Date.now();
  }

  removeClient(nodeId: string, socketId: string): void {
    const managed = this.docs.get(nodeId);
    if (!managed) return;

    managed.clients.delete(socketId);

    if (managed.clients.size === 0) {
      // 즉시 flush, idle timeout 후 메모리에서 제거
      this.flushDoc(nodeId).catch((err) =>
        this.handleFlushError(nodeId, err, 'Flush failed')
      );

      managed.idleTimer = setTimeout(() => {
        this.evictDoc(nodeId);
      }, DOC_IDLE_TIMEOUT_MS);
    }
  }

  getClientCount(nodeId: string): number {
    return this.docs.get(nodeId)?.clients.size ?? 0;
  }

  getDoc(nodeId: string): Y.Doc | undefined {
    return this.docs.get(nodeId)?.doc;
  }

  // ── Update 적용 ──────────────────────────────────────────────

  applyUpdate(nodeId: string, update: Uint8Array, userId?: string): void {
    const managed = this.docs.get(nodeId);
    if (!managed) return;

    Y.applyUpdate(managed.doc, update);
    this.scheduleSave(nodeId, userId);
  }

  async appendMarkdown(
    nodeId: string,
    workspaceId: string,
    markdown: string,
    userId: string
  ): Promise<{ update: Uint8Array; version: number; updatedAt: Date }> {
    return this.runExclusive(nodeId, async () => {
      const doc = await this.getOrCreateDoc(nodeId, workspaceId);
      const result = appendMarkdownToYjsDoc(doc, markdown);
      const managed = this.docs.get(nodeId)!;
      managed.dirtyForEmbed = true;
      managed.lastEditorUserId = userId;
      managed.lastActivity = Date.now();
      const persisted = await this.flushDoc(nodeId, result.markdown);
      return { update: result.update, ...persisted };
    });
  }

  private async runExclusive<T>(
    nodeId: string,
    task: () => Promise<T>
  ): Promise<T> {
    const previous = this.operations.get(nodeId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.operations.set(nodeId, current);
    try {
      return await current;
    } finally {
      if (this.operations.get(nodeId) === current)
        this.operations.delete(nodeId);
    }
  }

  /** doc에 이미 적용된 변경에 대해 debounced save만 예약 */
  scheduleSave(nodeId: string, userId?: string): void {
    const managed = this.docs.get(nodeId);
    if (!managed) return;

    managed.lastActivity = Date.now();
    managed.dirtyForEmbed = true;
    if (userId) managed.lastEditorUserId = userId;

    if (managed.saveTimer) clearTimeout(managed.saveTimer);
    managed.saveTimer = setTimeout(() => {
      this.flushDoc(nodeId).catch((err) =>
        this.handleFlushError(nodeId, err, 'Debounced flush failed')
      );
    }, DEBOUNCE_SAVE_MS);
  }

  // ── 영속화 ───────────────────────────────────────────────────

  async flushDoc(
    nodeId: string,
    knownMarkdown?: string
  ): Promise<{ version: number; updatedAt: Date }> {
    const managed = this.docs.get(nodeId);
    if (!managed) throw new Error(`Yjs doc is not loaded: ${nodeId}`);

    if (managed.saveTimer) {
      clearTimeout(managed.saveTimer);
      managed.saveTimer = null;
    }

    const state = Buffer.from(Y.encodeStateAsUpdate(managed.doc));
    const rootText = managed.doc.get('root', Y.XmlText).toString();
    const structuredMarkdown = knownMarkdown ?? yjsDocToMarkdown(managed.doc);
    // Legacy docs may contain plain XmlText instead of Lexical embeds.
    const markdownText = structuredMarkdown || rootText;

    const [, persisted] = await Promise.all([
      this.crdtService.saveToRedis(nodeId, state),
      this.crdtService.saveToDb(
        nodeId,
        state,
        markdownText,
        managed.workspaceId
      )
    ]);

    // 실제 편집이 있었던 flush에서만 재임베딩 job을 적재 (세이프티 플러시로 인한 중복 방지)
    if (managed.dirtyForEmbed && managed.lastEditorUserId) {
      managed.dirtyForEmbed = false;
      await this.embedQueueService.enqueueEmbedJob({
        nodeId,
        userId: managed.lastEditorUserId,
        workspaceId: managed.workspaceId
      });
    }
    return persisted;
  }

  async flushAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const nodeId of this.docs.keys()) {
      promises.push(
        this.flushDoc(nodeId)
          .then(() => undefined)
          .catch((err) =>
            this.handleFlushError(nodeId, err, 'Safety flush failed')
          )
      );
    }
    await Promise.all(promises);
  }

  // ── 정리 ─────────────────────────────────────────────────────

  /**
   * 백그라운드 flush 실패 처리. 노드가 이미 삭제된 경우(NODE_DELETE 유실 등)는
   * 30초마다 같은 에러가 반복되지 않도록 조용히 정리한다.
   */
  private handleFlushError(nodeId: string, err: unknown, context: string): void {
    if (err instanceof NodeGoneError) {
      this.logger.debug(`${nodeId} 노드가 삭제되어 doc을 정리합니다`);
      this.cleanupNode(nodeId).catch((cleanupErr) =>
        this.logger.error(`Cleanup failed for ${nodeId}`, cleanupErr)
      );
      return;
    }
    this.logger.error(`${context} for ${nodeId}`, err);
  }

  private evictDoc(nodeId: string): void {
    const managed = this.docs.get(nodeId);
    if (!managed) return;

    // 클라이언트가 다시 붙었으면 evict 취소
    if (managed.clients.size > 0) return;

    if (managed.saveTimer) clearTimeout(managed.saveTimer);
    if (managed.idleTimer) clearTimeout(managed.idleTimer);
    managed.doc.destroy();
    this.docs.delete(nodeId);
    this.logger.debug(`Evicted doc ${nodeId} from memory`);
  }

  /** 노드 삭제 시 호출: 메모리 + Redis 정리 */
  async cleanupNode(nodeId: string): Promise<void> {
    const managed = this.docs.get(nodeId);
    if (managed) {
      if (managed.saveTimer) clearTimeout(managed.saveTimer);
      if (managed.idleTimer) clearTimeout(managed.idleTimer);
      managed.doc.destroy();
      this.docs.delete(nodeId);
    }
    await this.crdtService.deleteFromRedis(nodeId);
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.flushInterval);
    await this.flushAll();
    for (const [, managed] of this.docs) {
      managed.doc.destroy();
    }
    this.docs.clear();
    this.logger.log('All Yjs docs flushed and destroyed');
  }
}
