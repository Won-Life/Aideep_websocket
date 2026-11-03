import { Module } from '@nestjs/common';
import { WsModule } from '@domain/ws/ws.module';
import { NodeContentModule } from '@domain/node-content/node-content.module';
import { EventBusSubscriber } from './service/event-bus.subscriber';

@Module({
  imports: [WsModule, NodeContentModule],
  providers: [EventBusSubscriber]
})
export class EventBusModule {}
