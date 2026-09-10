import { Module } from '@nestjs/common';
import { WsModule } from '@domain/ws/ws.module';
import { EventBusSubscriber } from './service/event-bus.subscriber';

@Module({
  imports: [WsModule],
  providers: [EventBusSubscriber]
})
export class EventBusModule {}
