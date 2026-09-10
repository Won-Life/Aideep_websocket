import { Module } from '@nestjs/common';
import { RealtimeAuthModule } from '@global/auth/realtime-auth.module';
import { YjsModule } from '@global/yjs/yjs.module';
import { WsModule } from '@domain/ws/ws.module';
import { MembershipRepository } from '@domain/membership/repository/membership.repository';
import { NodeContentController } from './controller/node-content.controller';
import { NodeContentService } from './service/node-content.service';
import { NodeContentRepository } from './repository/node-content.repository';

@Module({
  imports: [RealtimeAuthModule, YjsModule, WsModule],
  controllers: [NodeContentController],
  providers: [NodeContentService, NodeContentRepository, MembershipRepository]
})
export class NodeContentModule {}
