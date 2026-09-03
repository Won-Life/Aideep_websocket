import { Test, TestingModule } from '@nestjs/testing';
import * as Y from 'yjs';
import { YjsCrdtService } from './yjs-crdt.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import { FileAttachmentService } from 'src/file-attachment/file-attachment.service';
import { setTransactionRunner } from 'src/prisma/transaction.storage';

describe('YjsCrdtService', () => {
  let service: YjsCrdtService;
  let mockRedisGet: jest.Mock;
  let mockRedisSet: jest.Mock;
  let mockRedisDel: jest.Mock;
  let mockPrismaFindUnique: jest.Mock;
  let mockPrismaUpdate: jest.Mock;
  let mockSyncNodeAttachments: jest.Mock;

  beforeAll(() => {
    // @Transactional() 데코레이터가 사용하는 러너를 pass-through로 설정
    setTransactionRunner((fn) => fn());
  });

  beforeEach(async () => {
    mockRedisGet = jest.fn();
    mockRedisSet = jest.fn();
    mockRedisDel = jest.fn();
    mockPrismaFindUnique = jest.fn();
    mockPrismaUpdate = jest.fn();
    mockSyncNodeAttachments = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        YjsCrdtService,
        {
          provide: PrismaService,
          useValue: {
            client: {
              nodes: {
                findUnique: mockPrismaFindUnique,
                update: mockPrismaUpdate,
              },
            },
          },
        },
        {
          provide: RedisService,
          useValue: {
            getClient: () => ({
              get: mockRedisGet,
              set: mockRedisSet,
              del: mockRedisDel,
            }),
          },
        },
        {
          provide: FileAttachmentService,
          useValue: { syncNodeAttachments: mockSyncNodeAttachments },
        },
      ],
    }).compile();

    service = module.get<YjsCrdtService>(YjsCrdtService);
  });

  describe('Redis roundtrip (Base64)', () => {
    it('saveToRedis → loadFromRedis should preserve binary data', async () => {
      const doc = new Y.Doc();
      doc.getText('content').insert(0, 'Hello Yjs 🎉');
      const state = Buffer.from(Y.encodeStateAsUpdate(doc));
      doc.destroy();

      // saveToRedis stores base64 string
      let stored: string | null = null;
      mockRedisSet.mockImplementation(async (_key: string, value: string) => {
        stored = value;
      });

      await service.saveToRedis('node-1', state);
      expect(mockRedisSet).toHaveBeenCalledWith(
        expect.any(String),
        state.toString('base64'),
        { EX: 86_400 },
      );

      // loadFromRedis decodes base64
      mockRedisGet.mockResolvedValue(stored);
      const loaded = await service.loadFromRedis('node-1');

      expect(loaded).not.toBeNull();
      expect(Buffer.compare(loaded!, state)).toBe(0);

      // Verify the loaded state can reconstruct the doc
      const doc2 = new Y.Doc();
      Y.applyUpdate(doc2, new Uint8Array(loaded!));
      expect(doc2.getText('content').toString()).toBe('Hello Yjs 🎉');
      doc2.destroy();
    });

    it('loadFromRedis returns null when key does not exist', async () => {
      mockRedisGet.mockResolvedValue(null);
      const result = await service.loadFromRedis('nonexistent');
      expect(result).toBeNull();
    });

    it('loadFromRedis returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('connection lost'));
      const result = await service.loadFromRedis('node-1');
      expect(result).toBeNull();
    });
  });

  describe('loadFromDb', () => {
    it('returns yjs_state when present', async () => {
      const doc = new Y.Doc();
      doc.getText('content').insert(0, 'DB state');
      const state = Buffer.from(Y.encodeStateAsUpdate(doc));
      doc.destroy();

      mockPrismaFindUnique.mockResolvedValue({
        yjs_state: state,
        content: null,
        workspace_id: 'ws-1',
      });

      const result = await service.loadFromDb('node-1');
      expect(result).not.toBeNull();
      expect(Buffer.isBuffer(result!.state)).toBe(true);
      expect(result!.workspaceId).toBe('ws-1');
    });

    it('lazy migration: bootstraps from markdownBody when yjs_state is null', async () => {
      mockPrismaFindUnique.mockResolvedValue({
        yjs_state: null,
        content: { markdownBody: '# Title\nSome text' },
        workspace_id: 'ws-2',
      });

      const result = await service.loadFromDb('node-1');
      expect(result).not.toBeNull();
      expect(result!.state).not.toBeNull();

      // 이슈 #71: 평문이 아니라 Lexical @lexical/yjs 포맷(구조화된 트리)이어야 한다
      const doc = new Y.Doc();
      Y.applyUpdate(doc, new Uint8Array(result!.state!));
      const root = doc.get('root', Y.XmlText);
      expect(typeof root.toDelta()[0]?.insert).not.toBe('string'); // 평문 아님(구조화됨)
      expect(root.toString()).not.toBe('# Title\nSome text'); // 원문 그대로가 아님
      doc.destroy();
    });

    it('returns null state when node has no yjs_state and no markdownBody', async () => {
      mockPrismaFindUnique.mockResolvedValue({
        yjs_state: null,
        content: {},
        workspace_id: 'ws-3',
      });

      const result = await service.loadFromDb('node-1');
      expect(result).not.toBeNull();
      expect(result!.state).toBeNull();
    });

    it('returns null when node does not exist', async () => {
      mockPrismaFindUnique.mockResolvedValue(null);
      const result = await service.loadFromDb('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('deleteFromRedis', () => {
    it('deletes the key', async () => {
      mockRedisDel.mockResolvedValue(1);
      await service.deleteFromRedis('node-1');
      expect(mockRedisDel).toHaveBeenCalled();
    });
  });

  describe('saveToDb', () => {
    it('updates node content and syncs file attachments', async () => {
      mockPrismaFindUnique.mockResolvedValue({
        content: { dataType: 'MARKDOWN', markdownBody: 'old' },
      });
      mockPrismaUpdate.mockResolvedValue({});
      mockRedisDel.mockResolvedValue(1);

      const state = Buffer.from([1, 2, 3]);
      await service.saveToDb('node-1', state, '# new body', 'ws-1');

      expect(mockPrismaUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { node_id: 'node-1' },
          data: expect.objectContaining({
            content: { dataType: 'MARKDOWN', markdownBody: '# new body' },
          }),
        }),
      );
      expect(mockSyncNodeAttachments).toHaveBeenCalledWith('node-1', 'ws-1', {
        dataType: 'MARKDOWN',
        markdownBody: '# new body',
      });
    });
  });
});
