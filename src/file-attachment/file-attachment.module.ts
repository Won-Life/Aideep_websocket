import { Module } from '@nestjs/common';
import { S3Service } from 'src/upload/s3.service';
import { FileAttachmentRepository } from './file-attachment.repository';
import { FileAttachmentService } from './file-attachment.service';

@Module({
  providers: [FileAttachmentService, FileAttachmentRepository, S3Service],
  exports: [FileAttachmentService]
})
export class FileAttachmentModule {}
