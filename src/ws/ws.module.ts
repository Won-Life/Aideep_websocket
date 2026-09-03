import { Module } from '@nestjs/common';
import { WsGateway } from './ws.gateway';
import { RealtimeAuthModule } from '../auth/realtime-auth.module';
import { YjsModule } from '../yjs/yjs.module';
import { MembershipRepository } from '../membership/membership.repository';
import { PresenceService } from './presence.service';
import { MetricsModule } from '../common/metrics';

@Module({
  imports: [RealtimeAuthModule, YjsModule, MetricsModule],
  providers: [WsGateway, MembershipRepository, PresenceService],
  exports: [WsGateway]
})
export class WsModule {}
