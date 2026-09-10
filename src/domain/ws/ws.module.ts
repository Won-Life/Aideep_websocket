import { Module } from '@nestjs/common';
import { WsGateway } from './controller/ws.gateway';
import { RealtimeAuthModule } from '@global/auth/realtime-auth.module';
import { YjsModule } from '@global/yjs/yjs.module';
import { MembershipRepository } from '@domain/membership/repository/membership.repository';
import { PresenceService } from './service/presence.service';
import { WsLogService } from './service/ws-log.service';
import { MetricsModule } from '@global/common/metrics';

@Module({
  imports: [RealtimeAuthModule, YjsModule, MetricsModule],
  providers: [WsGateway, MembershipRepository, PresenceService, WsLogService],
  exports: [WsGateway]
})
export class WsModule {}
