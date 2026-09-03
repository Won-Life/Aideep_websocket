import { Module } from '@nestjs/common';
import { WsModule } from '../ws/ws.module';
import { RealtimeBusSubscriber } from './realtime-bus.subscriber';

@Module({
  imports: [WsModule],
  providers: [RealtimeBusSubscriber]
})
export class RealtimeBusModule {}
