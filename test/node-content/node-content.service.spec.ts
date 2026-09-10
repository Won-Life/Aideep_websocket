import { Test, TestingModule } from '@nestjs/testing';
import { NodeContentService } from '@domain/node-content/service/node-content.service';
import { NodeContentRepository } from '@domain/node-content/repository/node-content.repository';
import { MembershipRepository } from '@domain/membership/repository/membership.repository';
import { RedisService } from '@global/redis/redis.service';
import { WsGateway } from '@domain/ws/controller/ws.gateway';
import { YjsDocManager } from '@global/yjs/yjs-doc-manager';
import { setTransactionRunner } from '@global/prisma/transaction.storage';
import { NodeContentOperation } from '@domain/node-content/dto/nodeContentOperation.dto';

const MOCK_NODE_ID = '550e8400-e29b-41d4-a716-446655440000';
const MOCK_WORKSPACE_ID = 'ws-uuid-5678';
const MOCK_USER_ID = 'user-uuid-1234';

describe('NodeContentService', () => {
  let service: NodeContentService;
  let nodeContentRepository: { [K: string]: jest.Mock };
  let membershipRepository: { [K: string]: jest.Mock };
  let wsGateway: { broadcast: jest.Mock; broadcastYjsUpdate: jest.Mock };

  const mockRedisClient = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn()
  };
  const yjsDocManager = { appendMarkdown: jest.fn() };

  beforeAll(() => {
    // @Transactional() 데코레이터가 사용하는 러너를 pass-through로 설정
    setTransactionRunner((fn) => fn());
  });

  beforeEach(async () => {
    nodeContentRepository = { selectNodeById: jest.fn() };
    membershipRepository = { checkWorkspace: jest.fn() };
    wsGateway = { broadcast: jest.fn(), broadcastYjsUpdate: jest.fn() };
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NodeContentService,
        { provide: NodeContentRepository, useValue: nodeContentRepository },
        { provide: MembershipRepository, useValue: membershipRepository },
        {
          provide: RedisService,
          useValue: { getClient: () => mockRedisClient }
        },
        { provide: WsGateway, useValue: wsGateway },
        { provide: YjsDocManager, useValue: yjsDocManager }
      ]
    }).compile();

    service = module.get<NodeContentService>(NodeContentService);
  });

  const body = {
    operation: NodeContentOperation.APPEND_MARKDOWN,
    markdown: '## 추가 내용',
    expectedVersion: 2,
    source: { actorType: 'AGENT' as const, actorId: 'meeting-graph' }
  };

  beforeEach(() => {
    membershipRepository.checkWorkspace.mockResolvedValue({ role: 'EDITOR' });
    nodeContentRepository.selectNodeById.mockResolvedValue({
      version: 2,
      content: { dataType: 'MARKDOWN', markdownBody: '# 기존' }
    });
    yjsDocManager.appendMarkdown.mockResolvedValue({
      update: new Uint8Array([1, 2, 3]),
      version: 3,
      updatedAt: new Date('2026-08-26T10:00:00.000Z')
    });
    mockRedisClient.get.mockResolvedValue(null);
    mockRedisClient.set.mockResolvedValue('OK');
  });

  it('appends markdown and broadcasts the Yjs update', async () => {
    const result = await service.executeContentOperation(
      MOCK_USER_ID,
      MOCK_WORKSPACE_ID,
      MOCK_NODE_ID,
      'chunk-key-001',
      body
    );

    expect(yjsDocManager.appendMarkdown).toHaveBeenCalledWith(
      MOCK_NODE_ID,
      MOCK_WORKSPACE_ID,
      body.markdown,
      MOCK_USER_ID
    );
    expect(wsGateway.broadcastYjsUpdate).toHaveBeenCalledWith(
      MOCK_NODE_ID,
      expect.any(Uint8Array)
    );
    expect(result).toEqual(
      expect.objectContaining({
        previousVersion: 2,
        version: 3,
        duplicate: false
      })
    );
  });

  it('returns the cached result without appending twice', async () => {
    mockRedisClient.get.mockResolvedValue(
      JSON.stringify({
        requestHash: require('crypto')
          .createHash('sha256')
          .update(JSON.stringify(body))
          .digest('hex'),
        response: {
          operationId: 'op-1',
          nodeId: MOCK_NODE_ID,
          operation: NodeContentOperation.APPEND_MARKDOWN,
          previousVersion: 2,
          version: 3,
          updatedAt: '2026-08-26T10:00:00.000Z',
          duplicate: false
        }
      })
    );

    const result = await service.executeContentOperation(
      MOCK_USER_ID,
      MOCK_WORKSPACE_ID,
      MOCK_NODE_ID,
      'chunk-key-001',
      body
    );

    expect(result.duplicate).toBe(true);
    expect(yjsDocManager.appendMarkdown).not.toHaveBeenCalled();
  });

  it('rejects a stale expectedVersion without mutating the document', async () => {
    await expect(
      service.executeContentOperation(
        MOCK_USER_ID,
        MOCK_WORKSPACE_ID,
        MOCK_NODE_ID,
        'chunk-key-001',
        { ...body, expectedVersion: 1 }
      )
    ).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT', currentVersion: 2 }
    });

    expect(yjsDocManager.appendMarkdown).not.toHaveBeenCalled();
  });

  it('rejects a concurrent request when the idempotency claim is held', async () => {
    mockRedisClient.set.mockResolvedValueOnce(null);

    await expect(
      service.executeContentOperation(
        MOCK_USER_ID,
        MOCK_WORKSPACE_ID,
        MOCK_NODE_ID,
        'chunk-key-001',
        body
      )
    ).rejects.toMatchObject({
      response: { code: 'OPERATION_IN_PROGRESS' }
    });

    expect(yjsDocManager.appendMarkdown).not.toHaveBeenCalled();
  });
});
