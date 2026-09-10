import { Module } from '@nestjs/common';
import { S3Service } from '@global/upload/s3.service';
import { FileAttachmentRepository } from './repository/file-attachment.repository';
import { FileAttachmentService } from './service/file-attachment.service';

@Module({
  providers: [FileAttachmentService, FileAttachmentRepository, S3Service],
  exports: [FileAttachmentService]
})
export class FileAttachmentModule {}
