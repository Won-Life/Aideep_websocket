import { Test, TestingModule } from '@nestjs/testing';
import { WsGateway } from '@domain/ws/controller/ws.gateway';
import { JwtService } from '@nestjs/jwt';
import { YjsDocManager } from '@global/yjs/yjs-doc-manager';
import { YjsWsAwarenessService } from '@global/yjs/yjs-ws-awareness.service';
import { MembershipRepository } from '@domain/membership/repository/membership.repository';
import { PresenceService } from '@domain/ws/service/presence.service';
import { WsMetricsService } from '@global/common/metrics';
import { Socket, Server } from 'socket.io';

describe('WsGateway', () => {
  let gateway: WsGateway;
  let jwtService: JwtService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WsGateway,
        {
          provide: JwtService,
          useValue: {
            verify: jest.fn()
          }
        },
        {
          provide: YjsDocManager,
          useValue: {
            getOrCreateDoc: jest.fn(),
            addClient: jest.fn(),
            removeClient: jest.fn(),
            scheduleSave: jest.fn(),
            cleanupNode: jest.fn().mockResolvedValue(undefined)
          }
        },
        {
          provide: YjsWsAwarenessService,
          useValue: {
            getCachedAwareness: jest.fn().mockResolvedValue(null),
            cacheAwareness: jest.fn().mockResolvedValue(undefined),
            deleteAwareness: jest.fn().mockResolvedValue(undefined)
          }
        },
        {
          provide: MembershipRepository,
          useValue: {
            checkWorkspace: jest
              .fn()
              .mockResolvedValue({ role: 'EDITOR', deleted_at: null })
          }
        },
        {
          provide: PresenceService,
          useValue: {
            upsertPresence: jest.fn().mockResolvedValue(undefined),
            removePresence: jest.fn().mockResolvedValue(undefined),
            listPresence: jest.fn().mockResolvedValue([])
          }
        },
        {
          provide: WsMetricsService,
          useValue: {
            increment: jest.fn(),
            decrement: jest.fn()
          }
        }
      ]
    }).compile();

    gateway = module.get<WsGateway>(WsGateway);
    jwtService = module.get<JwtService>(JwtService);

    // Inject a mock Server
    const mockServer: any = {
      to: jest.fn().mockReturnThis(),
      except: jest.fn().mockReturnThis(),
      emit: jest.fn()
    };
    // broadcast()는 server.local.to(...)로 emit한다
    mockServer.local = mockServer;
    gateway.server = mockServer as unknown as Server;
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('handleConnection', () => {
    it('should disconnect client when no token is provided', async () => {
      const client = {
        handshake: { auth: {}, query: {} },
        disconnect: jest.fn(),
        data: {}
      } as unknown as Socket;

      await gateway.handleConnection(client);
      expect(client.disconnect).toHaveBeenCalled();
    });

    it('should set userId on client.data when token is valid', async () => {
      const mockPayload = { user_id: 'user-123' };
      (jwtService.verify as jest.Mock).mockReturnValue(mockPayload);

      const client = {
        handshake: { auth: { token: 'valid-token' }, query: {} },
        disconnect: jest.fn(),
        join: jest.fn(),
        data: {}
      } as unknown as Socket;

      await gateway.handleConnection(client);
      expect(jwtService.verify).toHaveBeenCalledWith('valid-token');
      expect(client.data.userId).toBe('user-123');
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('should disconnect client when token verification fails', async () => {
      (jwtService.verify as jest.Mock).mockImplementation(() => {
        throw new Error('invalid token');
      });

      const client = {
        handshake: { auth: { token: 'bad-token' }, query: {} },
        disconnect: jest.fn(),
        data: {}
      } as unknown as Socket;

      await gateway.handleConnection(client);
      expect(client.disconnect).toHaveBeenCalled();
    });

    it('should accept token from query parameter', async () => {
      const mockPayload = { user_id: 'user-456' };
      (jwtService.verify as jest.Mock).mockReturnValue(mockPayload);

      const client = {
        handshake: { auth: {}, query: { token: 'query-token' } },
        disconnect: jest.fn(),
        join: jest.fn(),
        data: {}
      } as unknown as Socket;

      await gateway.handleConnection(client);
      expect(jwtService.verify).toHaveBeenCalledWith('query-token');
      expect(client.data.userId).toBe('user-456');
    });
  });

  describe('handleJoin', () => {
    it('should join the client to the workspace room and awareness room', async () => {
      const client = {
        join: jest.fn(),
        emit: jest.fn(),
        data: { userId: 'user-1' }
      } as unknown as Socket;

      await gateway.handleJoin(
        {
          workspaceId: 'ws-abc',
          userName: 'Alice',
          color: '#f00',
          profile: null
        },
        client
      );
      expect(client.join).toHaveBeenCalledWith('ws-abc');
      expect(client.join).toHaveBeenCalledWith('yjs:ws:ws-abc');
    });

    it('should upsert presence and broadcast presence_state', async () => {
      const presenceService = (gateway as unknown as { presenceService: any })
        .presenceService;
      presenceService.listPresence.mockResolvedValueOnce([
        {
          userId: 'user-1',
          userName: 'Alice',
          color: '#f00',
          profile: null
        }
      ]);

      const client = {
        join: jest.fn(),
        emit: jest.fn(),
        data: { userId: 'user-1' }
      } as unknown as Socket;

      await gateway.handleJoin(
        {
          workspaceId: 'ws-abc',
          userName: 'Alice',
          color: '#f00',
          profile: null
        },
        client
      );

      expect(presenceService.upsertPresence).toHaveBeenCalledWith('ws-abc', {
        userId: 'user-1',
        userName: 'Alice',
        color: '#f00',
        profile: null
      });
      expect(gateway.server.to).toHaveBeenCalledWith('ws-abc');
      expect(
        (gateway.server.to('ws-abc') as unknown as { emit: jest.Mock }).emit
      ).toHaveBeenCalledWith('presence_state', {
        workspaceId: 'ws-abc',
        members: [
          {
            userId: 'user-1',
            userName: 'Alice',
            color: '#f00',
            profile: null
          }
        ]
      });
    });
  });

  describe('handleLivePosition', () => {
    it('should broadcast node_position_live to the workspace room excluding sender', () => {
      const mockEmit = jest.fn();
      const client = {
        to: jest.fn().mockReturnValue({ emit: mockEmit })
      } as unknown as Socket;

      const payload = {
        workspaceId: 'ws-abc',
        nodeId: 'node-1',
        x: 150,
        y: 300
      };

      gateway.handleLivePosition(payload, client);

      expect(client.to).toHaveBeenCalledWith('ws-abc');
      expect(mockEmit).toHaveBeenCalledWith('node_position_live', payload);
    });

    it('should forward the exact payload without modification', () => {
      const mockEmit = jest.fn();
      const client = {
        to: jest.fn().mockReturnValue({ emit: mockEmit })
      } as unknown as Socket;

      const payload = {
        workspaceId: 'ws-xyz',
        nodeId: 'node-99',
        x: -42.5,
        y: 1000.123
      };

      gateway.handleLivePosition(payload, client);

      const emittedPayload = mockEmit.mock.calls[0][1];
      expect(emittedPayload).toEqual(payload);
      expect(emittedPayload.nodeId).toBe('node-99');
      expect(emittedPayload.x).toBe(-42.5);
      expect(emittedPayload.y).toBe(1000.123);
    });
  });

  describe('broadcast', () => {
    it('should emit workspace_event to the correct room', () => {
      const event = {
        type: 'NODE_CREATE' as const,
        workspaceId: 'ws-abc',
        userId: 'user-1',
        node: {
          nodeId: 'n1',
          title: 'Test',
          nodeType: 'PROJECT',
          position: { x: 0, y: 0 },
          data: {},
          createdAt: '2026-01-01'
        }
      };

      gateway.broadcast(event);
      expect(gateway.server.to).toHaveBeenCalledWith('ws-abc');
      expect(
        (gateway.server.to('ws-abc') as unknown as { emit: jest.Mock }).emit
      ).toHaveBeenCalledWith('workspace_event', event);
    });
  });
});
