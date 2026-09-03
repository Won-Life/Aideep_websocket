import { Module } from '@nestjs/common';
import { RealtimeAuthModule } from '../auth/realtime-auth.module';
import { YjsModule } from '../yjs/yjs.module';
import { WsModule } from '../ws/ws.module';
import { MembershipRepository } from '../membership/membership.repository';
import { NodeContentController } from './node-content.controller';
import { NodeContentService } from './node-content.service';
import { NodeContentRepository } from './node-content.repository';

@Module({
  imports: [RealtimeAuthModule, YjsModule, WsModule],
  controllers: [NodeContentController],
  providers: [NodeContentService, NodeContentRepository, MembershipRepository]
})
export class NodeContentModule {}
