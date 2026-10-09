import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from '@global/redis/redis.service';
import { WsGateway } from '@domain/ws/controller/ws.gateway';
import { EventBusSubscriber } from '@domain/event-bus/service/event-bus.subscriber';
import {
  EVENT_BUS_CONTRACT_VERSION,
  EventBusEnvelope
} from '@domain/event-bus/type/event-bus.contract';
import { WsEvent } from '@domain/ws/type/ws.event';

const envelope = (
  kind: EventBusEnvelope['kind'],
  payload: EventBusEnvelope['payload']
): string =>
  JSON.stringify({
    v: EVENT_BUS_CONTRACT_VERSION,
    kind,
    messageId: 'msg-1',
    publishedAt: '2026-09-04T12:00:00.000Z',
    origin: 'nest-api',
    payload
  });

describe('EventBusSubscriber', () => {
  let subscriber: EventBusSubscriber;
  let wsGateway: { broadcast: jest.Mock; broadcastYjsUpdate: jest.Mock };

  beforeEach(async () => {
    wsGateway = { broadcast: jest.fn(), broadcastYjsUpdate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventBusSubscriber,
        { provide: RedisService, useValue: { createSubscriber: jest.fn() } },
        { provide: WsGateway, useValue: wsGateway }
      ]
    }).compile();

    subscriber = module.get<EventBusSubscriber>(EventBusSubscriber);
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

  it.each([
    ['MEETING_BOT_REQUESTED', 'REQUESTED'],
    ['MEETING_BOT_JOINED', 'JOINED'],
    ['MEETING_BOT_LEFT', 'LEFT']
  ] as const)(
    '회의 이벤트 %s 를 가공 없이 게이트웨이로 넘긴다',
    (type, status) => {
      const event = {
        type,
        workspaceId: 'ws-abc',
        userId: 'user-1',
        meetingId: 'meeting-1',
        nodeId: 'node-1',
        botId: 'bot-1',
        status,
        occurredAt: '2026-10-09T02:51:25.449Z'
      } as unknown as WsEvent;

      subscriber.handleMessage(envelope('WORKSPACE_EVENT', event));

      expect(wsGateway.broadcast).toHaveBeenCalledWith(event);
    }
  );

  it('MEETING_BOT_FAILED 의 statusSubCode 를 보존한다', () => {
    const event = {
      type: 'MEETING_BOT_FAILED',
      workspaceId: 'ws-abc',
      userId: 'user-1',
      meetingId: 'meeting-1',
      nodeId: 'node-1',
      botId: 'bot-1',
      status: 'FAILED',
      statusSubCode: 'meeting_not_found',
      occurredAt: '2026-10-09T02:51:25.449Z'
    } as unknown as WsEvent;

    subscriber.handleMessage(envelope('WORKSPACE_EVENT', event));

    expect(wsGateway.broadcast).toHaveBeenCalledWith(event);
  });

  it('transport 지시 필드(targetRoom/socketId)는 payload 로 그대로 넘기고 라우팅에 쓰지 않는다', () => {
    // 라우팅은 WS 서버의 모델이다 — 백엔드가 전송 지시를 보내도 무시한다
    const event = {
      type: 'MEETING_BOT_JOINED',
      workspaceId: 'ws-abc',
      userId: 'user-1',
      meetingId: 'meeting-1',
      nodeId: 'node-1',
      botId: 'bot-1',
      status: 'JOINED',
      occurredAt: '2026-10-09T02:51:25.449Z',
      targetRoom: 'should-be-ignored',
      socketId: 'should-be-ignored'
    } as unknown as WsEvent;

    subscriber.handleMessage(envelope('WORKSPACE_EVENT', event));

    expect(wsGateway.broadcast).toHaveBeenCalledWith(event);
  });

  it('모르는 payload.type 도 화이트리스트 없이 그대로 전달한다', () => {
    const event = {
      type: 'SOMETHING_NEW',
      workspaceId: 'ws-abc'
    } as unknown as WsEvent;

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
    [
      'unsupported version',
      JSON.stringify({ v: 999, kind: 'WORKSPACE_EVENT' })
    ],
    ['unknown kind', envelope('SOMETHING_NEW' as any, {} as any)]
  ])('ignores %s without throwing', (_label, message) => {
    expect(() => subscriber.handleMessage(message)).not.toThrow();
    expect(wsGateway.broadcast).not.toHaveBeenCalled();
    expect(wsGateway.broadcastYjsUpdate).not.toHaveBeenCalled();
  });
});
