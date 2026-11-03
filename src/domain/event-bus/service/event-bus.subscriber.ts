import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RedisService } from '@global/redis/redis.service';
import { WsGateway } from '@domain/ws/controller/ws.gateway';
import { NodeContentService } from '@domain/node-content/service/node-content.service';
import {
  EVENT_BUS_CHANNEL,
  EVENT_BUS_CONTRACT_VERSION,
  EventBusEnvelope,
  NodeBodyPatchPayload,
  WsEvent,
  YjsUpdatePayload
} from '../type/event-bus.contract';

@Injectable()
export class EventBusSubscriber implements OnModuleInit {
  private readonly logger = new Logger(EventBusSubscriber.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly wsGateway: WsGateway,
    private readonly nodeContentService: NodeContentService
  ) {}

  async onModuleInit() {
    const subscriber = await this.redisService.createSubscriber('event-bus');
    await subscriber.subscribe(EVENT_BUS_CHANNEL, (message) =>
      this.handleMessage(message)
    );
    this.logger.log(`Subscribed to ${EVENT_BUS_CHANNEL}`);
  }

  /**
   * 구독 콜백의 예외는 unhandled rejection이 되어 프로세스를 죽일 수 있으므로
   * 어떤 경우에도 throw하지 않는다. 모르는 kind는 무시한다 (API가 새 이벤트를 먼저 배포해도 안 죽도록).
   */
  handleMessage(message: string): void {
    try {
      const envelope = JSON.parse(message) as EventBusEnvelope;

      if (envelope?.v !== EVENT_BUS_CONTRACT_VERSION) {
        this.logger.warn(`Unsupported envelope version: ${envelope?.v}`);
        return;
      }

      switch (envelope.kind) {
        case 'WORKSPACE_EVENT':
          this.wsGateway.broadcast(envelope.payload as WsEvent);
          return;
        case 'YJS_UPDATE': {
          const payload = envelope.payload as YjsUpdatePayload;
          this.wsGateway.broadcastYjsUpdate(
            payload.nodeId,
            new Uint8Array(Buffer.from(payload.updateBase64, 'base64'))
          );
          return;
        }
        // 중계가 아니라 적용이므로 비동기다. 구독 콜백을 막지 않도록 await하지 않고,
        // 서비스가 자체적으로 예외를 삼키므로 여기서는 catch만 보강한다.
        case 'NODE_BODY_PATCH':
          void this.nodeContentService
            .applyNodeBodyPatch(envelope.payload as NodeBodyPatchPayload)
            .catch((err) =>
              this.logger.error('Failed to apply node body patch', err)
            );
          return;
        default:
          this.logger.warn(`Unknown envelope kind: ${envelope.kind}`);
      }
    } catch (err) {
      this.logger.error(`Failed to handle realtime message: ${message}`, err);
    }
  }
}
