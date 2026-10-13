import * as Y from 'yjs';
import { YjsDocManager } from '@global/yjs/yjs-doc-manager';
import { YjsCrdtService } from '@global/yjs/yjs-crdt.service';
import { EmbedQueueService } from '@global/redis/embed-queue.service';
import { DEBOUNCE_SAVE_MS, FLUSH_CONCURRENCY } from '@global/yjs/yjs.constants';
import {
  markdownToYjsUpdate,
  yjsDocToMarkdown
} from '@global/yjs/markdown-yjs';

describe('YjsDocManager', () => {
  let manager: YjsDocManager;
  let mockCrdtService: jest.Mocked<YjsCrdtService>;
  let mockEmbedQueueService: jest.Mocked<EmbedQueueService>;

  beforeEach(() => {
    mockCrdtService = {
      loadFromRedis: jest.fn().mockResolvedValue(null),
      loadFromDb: jest.fn().mockResolvedValue(null),
      saveToRedis: jest.fn().mockResolvedValue(undefined),
      saveToDb: jest.fn().mockResolvedValue({
        version: 1,
        updatedAt: new Date('2026-08-26T00:00:00.000Z')
      }),
      deleteFromRedis: jest.fn().mockResolvedValue(undefined)
    } as any;

    mockEmbedQueueService = {
      enqueueEmbedJob: jest.fn().mockResolvedValue(undefined)
    } as any;

    manager = new YjsDocManager(mockCrdtService, mockEmbedQueueService);
  });

  afterEach(async () => {
    await manager.onModuleDestroy();
  });

  describe('getOrCreateDoc', () => {
    it('creates a new doc when none exists', async () => {
      const doc = await manager.getOrCreateDoc('node-1', 'ws-1');
      expect(doc).toBeInstanceOf(Y.Doc);
      expect(doc.getText('content').toString()).toBe('');
    });

    it('returns the same doc on subsequent calls', async () => {
      const doc1 = await manager.getOrCreateDoc('node-1', 'ws-1');
      const doc2 = await manager.getOrCreateDoc('node-1', 'ws-1');
      expect(doc1).toBe(doc2);
    });

    it('loads state from Redis if available', async () => {
      const seedDoc = new Y.Doc();
      seedDoc.getText('content').insert(0, 'From Redis');
      const state = Buffer.from(Y.encodeStateAsUpdate(seedDoc));
      seedDoc.destroy();

      mockCrdtService.loadFromRedis.mockResolvedValue(state);

      const doc = await manager.getOrCreateDoc('node-1', 'ws-1');
      expect(doc.getText('content').toString()).toBe('From Redis');
    });

    it('falls back to DB when Redis has no data', async () => {
      const seedDoc = new Y.Doc();
      seedDoc.getText('content').insert(0, 'From DB');
      const state = Buffer.from(Y.encodeStateAsUpdate(seedDoc));
      seedDoc.destroy();

      mockCrdtService.loadFromRedis.mockResolvedValue(null);
      mockCrdtService.loadFromDb.mockResolvedValue({
        state,
        workspaceId: 'ws-1'
      });

      const doc = await manager.getOrCreateDoc('node-1', 'ws-1');
      expect(doc.getText('content').toString()).toBe('From DB');
    });

    it('prevents concurrent loads for the same nodeId', async () => {
      const [doc1, doc2] = await Promise.all([
        manager.getOrCreateDoc('node-1', 'ws-1'),
        manager.getOrCreateDoc('node-1', 'ws-1')
      ]);
      expect(doc1).toBe(doc2);
      // loadFromRedis should be called only once
      expect(mockCrdtService.loadFromRedis).toHaveBeenCalledTimes(1);
    });
  });

  describe('client tracking', () => {
    it('addClient / removeClient / getClientCount', async () => {
      await manager.getOrCreateDoc('node-1', 'ws-1');

      manager.addClient('node-1', 'socket-a');
      manager.addClient('node-1', 'socket-b');
      expect(manager.getClientCount('node-1')).toBe(2);

      manager.removeClient('node-1', 'socket-a');
      expect(manager.getClientCount('node-1')).toBe(1);
    });

    it('removeClient triggers flush when last client leaves', async () => {
      await manager.getOrCreateDoc('node-1', 'ws-1');
      manager.addClient('node-1', 'socket-a');

      const flushSpy = jest
        .spyOn(manager, 'flushDoc')
        .mockResolvedValue({ version: 1, updatedAt: new Date() });

      manager.removeClient('node-1', 'socket-a');
      expect(flushSpy).toHaveBeenCalledWith('node-1');
    });
  });

  describe('applyUpdate', () => {
    it('applies update to the doc and schedules save', async () => {
      const doc = await manager.getOrCreateDoc('node-1', 'ws-1');
      manager.addClient('node-1', 'socket-a');

      // Create an update from a separate doc
      const clientDoc = new Y.Doc();
      clientDoc.getText('content').insert(0, 'Hello');
      const update = Y.encodeStateAsUpdate(clientDoc);
      clientDoc.destroy();

      manager.applyUpdate('node-1', update);
      expect(doc.getText('content').toString()).toBe('Hello');
    });
  });

  describe('scheduleSave', () => {
    it('does not re-apply update, only schedules flush', async () => {
      const doc = await manager.getOrCreateDoc('node-1', 'ws-1');

      // Pre-populate doc
      const clientDoc = new Y.Doc();
      clientDoc.getText('content').insert(0, 'Test');
      const update = Y.encodeStateAsUpdate(clientDoc);
      clientDoc.destroy();
      Y.applyUpdate(doc, update);

      const originalText = doc.get('root', Y.XmlText).toString();
      manager.scheduleSave('node-1');

      // Text should remain unchanged (no double-apply)
      expect(doc.get('root', Y.XmlText).toString()).toBe(originalText);
    });
  });

  describe('flushDoc', () => {
    it('saves state to both Redis and DB', async () => {
      const doc = await manager.getOrCreateDoc('node-1', 'ws-1');
      doc.get('root', Y.XmlText).insert(0, 'Flush me');

      await manager.flushDoc('node-1');

      expect(mockCrdtService.saveToRedis).toHaveBeenCalledWith(
        'node-1',
        expect.any(Buffer)
      );
      expect(mockCrdtService.saveToDb).toHaveBeenCalledWith(
        'node-1',
        expect.any(Buffer),
        'Flush me',
        'ws-1'
      );
    });

    it('does not enqueue an embed job when flushed without a tracked edit (e.g. safety flush of an untouched doc)', async () => {
      const doc = await manager.getOrCreateDoc('node-1', 'ws-1');
      doc.get('root', Y.XmlText).insert(0, 'Flush me');

      await manager.flushDoc('node-1');

      expect(mockEmbedQueueService.enqueueEmbedJob).not.toHaveBeenCalled();
    });

    it('enqueues an embed job when the doc was edited via scheduleSave with a userId', async () => {
      await manager.getOrCreateDoc('node-1', 'ws-1');
      manager.scheduleSave('node-1', 'user-1');

      await manager.flushDoc('node-1');

      expect(mockEmbedQueueService.enqueueEmbedJob).toHaveBeenCalledWith({
        nodeId: 'node-1',
        userId: 'user-1',
        workspaceId: 'ws-1'
      });
    });

    it('does not enqueue an embed job twice for a single edit (dirty flag reset after flush)', async () => {
      await manager.getOrCreateDoc('node-1', 'ws-1');
      manager.scheduleSave('node-1', 'user-1');

      await manager.flushDoc('node-1');
      await manager.flushDoc('node-1');

      expect(mockEmbedQueueService.enqueueEmbedJob).toHaveBeenCalledTimes(1);
    });
  });

  describe('flushDoc 직렬화 (P2028 회귀)', () => {
    it('같은 노드의 flush가 겹쳐 호출되어도 saveToDb가 동시에 실행되지 않는다', async () => {
      const doc = await manager.getOrCreateDoc('node-1', 'ws-1');

      let inFlight = 0;
      let maxInFlight = 0;
      const releases: (() => void)[] = [];
      mockCrdtService.saveToDb.mockImplementation(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise<void>((resolve) => releases.push(resolve));
        inFlight -= 1;
        return { version: 1, updatedAt: new Date() };
      });

      const tick = () => new Promise((r) => setImmediate(r));
      const waitForInFlight = async () => {
        for (let i = 0; i < 100 && releases.length === 0; i++) await tick();
        return releases.shift()!;
      };

      // 첫 flush를 in-flight 상태로 만든다 (여기서 state 캡처 완료)
      doc.get('root', Y.XmlText).insert(0, 'first');
      const first = manager.flushDoc('node-1');
      const releaseFirst = await waitForInFlight();
      expect(mockCrdtService.saveToDb).toHaveBeenCalledTimes(1);

      // 첫 flush가 아직 안 끝난 상태에서 두 번째 flush를 겹쳐 호출
      doc.get('root', Y.XmlText).insert(0, 'second');
      const second = manager.flushDoc('node-1');
      await tick();
      await tick();

      // 두 번째는 큐에서 대기만 하고 아직 트랜잭션을 열지 않아야 한다
      expect(mockCrdtService.saveToDb).toHaveBeenCalledTimes(1);

      releaseFirst();
      await first;
      (await waitForInFlight())();
      await second;

      expect(mockCrdtService.saveToDb).toHaveBeenCalledTimes(2);
      expect(maxInFlight).toBe(1);
    });

    it('appendMarkdown 경로는 큐를 이미 점유한 상태라 데드락 없이 완료된다', async () => {
      const result = await manager.appendMarkdown(
        'node-1',
        'ws-1',
        '## 추가',
        'user-1'
      );
      expect(result.version).toBe(1);
      expect(mockCrdtService.saveToDb).toHaveBeenCalledTimes(1);
    });
  });

  describe('변경 없는 flush는 DB를 건드리지 않는다 (열었다 닫기 반복 회귀)', () => {
    it('두 번째 flush는 state가 그대로이므로 saveToDb를 호출하지 않는다', async () => {
      const doc = await manager.getOrCreateDoc('node-1', 'ws-1');
      doc.get('root', Y.XmlText).insert(0, 'edited');

      await manager.flushDoc('node-1');
      expect(mockCrdtService.saveToDb).toHaveBeenCalledTimes(1);

      // 편집 없이 열었다 닫기만 반복한 상황
      await manager.flushDoc('node-1');
      await manager.flushDoc('node-1');
      expect(mockCrdtService.saveToDb).toHaveBeenCalledTimes(1);
    });

    it('건너뛴 flush도 마지막 저장 결과를 그대로 돌려준다', async () => {
      const doc = await manager.getOrCreateDoc('node-1', 'ws-1');
      doc.get('root', Y.XmlText).insert(0, 'edited');
      mockCrdtService.saveToDb.mockResolvedValue({
        version: 7,
        updatedAt: new Date('2026-08-26T00:00:00.000Z')
      });

      const persisted = await manager.flushDoc('node-1');
      const skipped = await manager.flushDoc('node-1');

      expect(skipped).toEqual(persisted);
      expect(skipped.version).toBe(7);
    });

    it('건너뛸 때도 Redis 캐시는 갱신한다', async () => {
      const doc = await manager.getOrCreateDoc('node-1', 'ws-1');
      doc.get('root', Y.XmlText).insert(0, 'edited');

      await manager.flushDoc('node-1');
      mockCrdtService.saveToRedis.mockClear();
      await manager.flushDoc('node-1');

      expect(mockCrdtService.saveToRedis).toHaveBeenCalledTimes(1);
    });

    it('다시 편집하면 saveToDb가 재개된다', async () => {
      const doc = await manager.getOrCreateDoc('node-1', 'ws-1');
      doc.get('root', Y.XmlText).insert(0, 'first');
      await manager.flushDoc('node-1');
      await manager.flushDoc('node-1');
      expect(mockCrdtService.saveToDb).toHaveBeenCalledTimes(1);

      doc.get('root', Y.XmlText).insert(0, 'second');
      await manager.flushDoc('node-1');
      expect(mockCrdtService.saveToDb).toHaveBeenCalledTimes(2);
    });

    it('DB 저장이 실패하면 다음 flush가 다시 저장을 시도한다', async () => {
      const doc = await manager.getOrCreateDoc('node-1', 'ws-1');
      doc.get('root', Y.XmlText).insert(0, 'edited');

      mockCrdtService.saveToDb.mockRejectedValueOnce(new Error('db down'));
      await expect(manager.flushDoc('node-1')).rejects.toThrow('db down');

      await manager.flushDoc('node-1');
      expect(mockCrdtService.saveToDb).toHaveBeenCalledTimes(2);
    });
  });

  describe('appendMarkdown', () => {
    it('appends through the Lexical binding and flushes the persisted state', async () => {
      const seed = Buffer.from(markdownToYjsUpdate('# 기존 제목'));
      mockCrdtService.loadFromDb.mockResolvedValue({
        state: seed,
        workspaceId: 'ws-1'
      });
      mockCrdtService.saveToDb.mockResolvedValue({
        version: 3,
        updatedAt: new Date('2026-08-26T10:00:00.000Z')
      });

      const result = await manager.appendMarkdown(
        'node-1',
        'ws-1',
        '## 추가 내용\n\n- 결정 A',
        'agent-user'
      );

      const doc = await manager.getOrCreateDoc('node-1', 'ws-1');
      const markdown = yjsDocToMarkdown(doc);
      expect(markdown).toContain('# 기존 제목');
      expect(markdown).toContain('## 추가 내용');
      expect(markdown).toContain('- 결정 A');
      expect(result.version).toBe(3);
      expect(result.update.byteLength).toBeGreaterThan(0);
      expect(mockCrdtService.saveToDb).toHaveBeenCalledTimes(1);
      expect(mockEmbedQueueService.enqueueEmbedJob).toHaveBeenCalledTimes(1);
    });
  });

  describe('debounced auto-flush (실제 setTimeout 트리거 검증)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('DEBOUNCE_SAVE_MS가 지나기 전에는 자동 flush가 발생하지 않는다', async () => {
      await manager.getOrCreateDoc('node-1', 'ws-1');
      manager.scheduleSave('node-1', 'user-1');

      await jest.advanceTimersByTimeAsync(DEBOUNCE_SAVE_MS - 1);

      expect(mockCrdtService.saveToDb).not.toHaveBeenCalled();
      expect(mockEmbedQueueService.enqueueEmbedJob).not.toHaveBeenCalled();
    });

    it('DEBOUNCE_SAVE_MS가 지나면 자동으로 flushDoc이 실행되어 embed job이 enqueue된다', async () => {
      await manager.getOrCreateDoc('node-1', 'ws-1');
      manager.scheduleSave('node-1', 'user-1');

      await jest.advanceTimersByTimeAsync(DEBOUNCE_SAVE_MS);

      expect(mockCrdtService.saveToDb).toHaveBeenCalledTimes(1);
      expect(mockEmbedQueueService.enqueueEmbedJob).toHaveBeenCalledWith({
        nodeId: 'node-1',
        userId: 'user-1',
        workspaceId: 'ws-1'
      });
    });

    it('DEBOUNCE_SAVE_MS 이내에 연속 편집하면 타이머가 리셋되어 마지막 호출 기준으로 1회만 flush된다', async () => {
      await manager.getOrCreateDoc('node-1', 'ws-1');

      manager.scheduleSave('node-1', 'user-1');
      await jest.advanceTimersByTimeAsync(DEBOUNCE_SAVE_MS - 500);
      manager.scheduleSave('node-1', 'user-1'); // 타이머 리셋

      // 최초 호출 기준으로는 이미 지났어야 할 시점이지만, 리셋되어 아직 flush 안 됨
      await jest.advanceTimersByTimeAsync(DEBOUNCE_SAVE_MS - 1);
      expect(mockCrdtService.saveToDb).not.toHaveBeenCalled();

      // 리셋된 타이머 기준 DEBOUNCE_SAVE_MS 경과
      await jest.advanceTimersByTimeAsync(1);
      expect(mockCrdtService.saveToDb).toHaveBeenCalledTimes(1);
      expect(mockEmbedQueueService.enqueueEmbedJob).toHaveBeenCalledTimes(1);
    });
  });

  describe('flushAll 동시성 제한', () => {
    it('doc 이 많아도 동시에 FLUSH_CONCURRENCY 개까지만 저장한다', async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      mockCrdtService.saveToDb.mockImplementation(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setImmediate(r));
        inFlight -= 1;
        return { version: 1, updatedAt: new Date() };
      });

      for (let i = 0; i < 20; i++) {
        const doc = await manager.getOrCreateDoc(`node-${i}`, 'ws-1');
        doc.get('root', Y.XmlText).insert(0, `edit-${i}`);
      }

      await manager.flushAll();

      expect(mockCrdtService.saveToDb).toHaveBeenCalledTimes(20);
      expect(maxInFlight).toBeLessThanOrEqual(FLUSH_CONCURRENCY);
    });
  });

  describe('cleanupNode', () => {
    it('destroys doc and deletes from Redis', async () => {
      await manager.getOrCreateDoc('node-1', 'ws-1');
      await manager.cleanupNode('node-1');

      expect(mockCrdtService.deleteFromRedis).toHaveBeenCalledWith('node-1');
      expect(manager.getClientCount('node-1')).toBe(0);
    });
  });
});
