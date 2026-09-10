import { Module } from '@nestjs/common';
import { WsModule } from '@domain/ws/ws.module';
import { RealtimeBusSubscriber } from './service/realtime-bus.subscriber';

@Module({
  imports: [WsModule],
  providers: [RealtimeBusSubscriber]
})
export class RealtimeBusModule {}
