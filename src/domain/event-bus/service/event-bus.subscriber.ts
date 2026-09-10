import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RedisService } from '@global/redis/redis.service';
import { WsGateway } from '@domain/ws/controller/ws.gateway';
import {
  EVENT_BUS_CHANNEL,
  EVENT_BUS_CONTRACT_VERSION,
  EventBusEnvelope,
  WsEvent,
  YjsUpdatePayload
} from '../type/event-bus.contract';

@Injectable()
export class EventBusSubscriber implements OnModuleInit {
  private readonly logger = new Logger(EventBusSubscriber.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly wsGateway: WsGateway
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
        default:
          this.logger.warn(`Unknown envelope kind: ${envelope.kind}`);
      }
    } catch (err) {
      this.logger.error(`Failed to handle realtime message: ${message}`, err);
    }
  }
}
