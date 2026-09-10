import { Logger } from '@nestjs/common';
import { Socket } from 'socket.io';
import { WsLogService } from '@domain/ws/service/ws-log.service';

const makeClient = (data: Record<string, unknown> = {}): Socket =>
  ({ id: 'sock-1', data }) as unknown as Socket;

describe('WsLogService', () => {
  let service: WsLogService;
  let log: jest.SpyInstance;
  let verbose: jest.SpyInstance;
  let warn: jest.SpyInstance;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    service = new WsLogService();
    const logger = (service as unknown as { logger: Logger }).logger;
    log = jest.spyOn(logger, 'log').mockImplementation();
    verbose = jest.spyOn(logger, 'verbose').mockImplementation();
    warn = jest.spyOn(logger, 'warn').mockImplementation();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.restoreAllMocks();
  });

  describe('inbound', () => {
    it('should log normal events at log level', () => {
      service.inbound(makeClient({ userId: 'u1' }), 'join_workspace', {
        workspaceId: 'ws-1'
      });

      expect(log).toHaveBeenCalledTimes(1);
      expect(verbose).not.toHaveBeenCalled();
      const line = log.mock.calls[0][0] as string;
      expect(line).toContain('[WS inbound]');
      expect(line).toContain('join_workspace');
      expect(line).toContain('socket=sock-1');
      expect(line).toContain('user=u1');
      expect(line).toContain('ws=ws-1');
    });

    it('should log high frequency events at verbose level', () => {
      service.inbound(makeClient({ userId: 'u1' }), 'cursor_move', {
        workspaceId: 'ws-1',
        x: 1,
        y: 2
      });

      expect(verbose).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalled();
    });

    it('should skip high frequency events entirely in production', () => {
      process.env.NODE_ENV = 'production';

      service.inbound(makeClient({ userId: 'u1' }), 'yjs:sync', {
        nodeId: 'n1',
        data: [1, 2, 3]
      });

      expect(verbose).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    });

    it('should redact binary payload fields in development', () => {
      service.inbound(makeClient({ userId: 'u1' }), 'yjs:awareness', {
        nodeId: 'n1',
        data: [1, 2, 3, 4, 5]
      });

      const line = verbose.mock.calls[0][0] as string;
      expect(line).toContain('<binary 5B>');
      expect(line).not.toContain('[1,2,3,4,5]');
      expect(line).toContain('node=n1');
    });

    it('should fall back to the socket workspaceId when the payload has none', () => {
      service.inbound(
        makeClient({ userId: 'u1', workspaceId: 'ws-from-socket' }),
        'yjs:leave',
        { nodeId: 'n1' }
      );

      expect(log.mock.calls[0][0]).toContain('ws=ws-from-socket');
    });

    it('should emit a JSON line in production for normal events', () => {
      process.env.NODE_ENV = 'production';

      service.inbound(makeClient({ userId: 'u1' }), 'join_workspace', {
        workspaceId: 'ws-1'
      });

      const parsed = JSON.parse(log.mock.calls[0][0] as string);
      expect(parsed.type).toBe('ws.inbound');
      expect(parsed.event).toBe('join_workspace');
      expect(parsed.userId).toBe('u1');
      // 페이로드 전문은 prod 에서 남기지 않는다
      expect(parsed.payload).toBeUndefined();
    });
  });

  describe('broadcast', () => {
    it('should log a workspace_event broadcast at log level', () => {
      service.broadcast('workspace_event:NODE_CREATE', {
        workspaceId: 'ws-1',
        userId: 'u1'
      });

      const line = log.mock.calls[0][0] as string;
      expect(line).toContain('[WS broadcast]');
      expect(line).toContain('workspace_event:NODE_CREATE');
    });

    it('should log a yjs update broadcast at verbose level with byte size', () => {
      service.broadcast('yjs:sync', { nodeId: 'n1', bytes: 42 });

      const line = verbose.mock.calls[0][0] as string;
      expect(line).toContain('node=n1');
      expect(line).toContain('42B');
    });
  });

  describe('connection lifecycle', () => {
    it('should log connect and disconnect at log level', () => {
      const client = makeClient({ userId: 'u1', workspaceId: 'ws-1' });

      service.connect(client);
      service.disconnect(client);

      expect(log).toHaveBeenCalledTimes(2);
      expect(log.mock.calls[0][0]).toContain('[WS connect]');
      expect(log.mock.calls[1][0]).toContain('[WS disconnect]');
    });

    it('should log a rejected connection at warn level with the reason', () => {
      service.rejected(makeClient(), 'no token');

      const line = warn.mock.calls[0][0] as string;
      expect(line).toContain('[WS rejected]');
      expect(line).toContain('(no token)');
    });
  });
});
