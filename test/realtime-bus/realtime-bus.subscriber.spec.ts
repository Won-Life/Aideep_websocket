import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from '@global/redis/redis.service';
import { WsGateway } from '@domain/ws/controller/ws.gateway';
import { RealtimeBusSubscriber } from '@domain/realtime-bus/service/realtime-bus.subscriber';
import {
  REALTIME_CONTRACT_VERSION,
  RealtimeEnvelope
} from '@domain/realtime-bus/type/realtime-bus.contract';
import { WsEvent } from '@domain/ws/type/ws.event';

const envelope = (
  kind: RealtimeEnvelope['kind'],
  payload: RealtimeEnvelope['payload']
): string =>
  JSON.stringify({
    v: REALTIME_CONTRACT_VERSION,
    kind,
    messageId: 'msg-1',
    publishedAt: '2026-09-04T12:00:00.000Z',
    origin: 'nest-api',
    payload
  });

describe('RealtimeBusSubscriber', () => {
  let subscriber: RealtimeBusSubscriber;
  let wsGateway: { broadcast: jest.Mock; broadcastYjsUpdate: jest.Mock };

  beforeEach(async () => {
    wsGateway = { broadcast: jest.fn(), broadcastYjsUpdate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeBusSubscriber,
        { provide: RedisService, useValue: { createSubscriber: jest.fn() } },
        { provide: WsGateway, useValue: wsGateway }
      ]
    }).compile();

    subscriber = module.get<RealtimeBusSubscriber>(RealtimeBusSubscriber);
  });

  it('dispatches WORKSPACE_EVENT payload to the gateway untouched', () => {
    const event: WsEvent = {
      type: 'NODE_DELETE',
      workspaceId: 'ws-abc',
      userId: 'user-1',
      nodeId: 'node-1'
    };

    subscriber.handleMessage(envelope('WORKSPACE_EVENT', event));

    expect(wsGateway.broadcast).toHaveBeenCalledWith(event);
  });

  it('decodes YJS_UPDATE base64 into a Uint8Array', () => {
    subscriber.handleMessage(
      envelope('YJS_UPDATE', {
        nodeId: 'node-1',
        updateBase64: Buffer.from([1, 2, 3]).toString('base64')
      })
    );

    expect(wsGateway.broadcastYjsUpdate).toHaveBeenCalledWith(
      'node-1',
      new Uint8Array([1, 2, 3])
    );
  });

  it.each([
    ['malformed JSON', 'not-json'],
    ['unsupported version', JSON.stringify({ v: 999, kind: 'WORKSPACE_EVENT' })],
    ['unknown kind', envelope('SOMETHING_NEW' as any, {} as any)]
  ])('ignores %s without throwing', (_label, message) => {
    expect(() => subscriber.handleMessage(message)).not.toThrow();
    expect(wsGateway.broadcast).not.toHaveBeenCalled();
    expect(wsGateway.broadcastYjsUpdate).not.toHaveBeenCalled();
  });
});
