import { Module } from '@nestjs/common';
import { YjsCrdtService } from './yjs-crdt.service';
import { YjsDocManager } from './yjs-doc-manager';
import { YjsWsAwarenessService } from './yjs-ws-awareness.service';
import { FileAttachmentModule } from 'src/file-attachment/file-attachment.module';

@Module({
  imports: [FileAttachmentModule],
  providers: [YjsCrdtService, YjsDocManager, YjsWsAwarenessService],
  exports: [YjsDocManager, YjsWsAwarenessService]
})
export class YjsModule {}
