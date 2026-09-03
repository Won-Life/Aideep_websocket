import { Injectable, Logger } from '@nestjs/common';
import { S3Service } from 'src/upload/s3.service';
import { FileAttachmentRepository } from './file-attachment.repository';

@Injectable()
export class FileAttachmentService {
  private readonly logger = new Logger(FileAttachmentService.name);

  constructor(
    private readonly fileAttachmentRepository: FileAttachmentRepository,
    private readonly s3Service: S3Service
  ) {}

  /**
   * 노드 content에서 참조 중인 파일의 file_id 목록을 추출합니다.
   * content를 문자열화해 S3 공개 URL을 정규식으로 찾고,
   * 워크스페이스 경계 내의 files 행과 매칭합니다.
   */
  async extractReferencedFileIds(
    content: unknown,
    workspaceId: string
  ): Promise<string[]> {
    if (!content) return [];

    const text = JSON.stringify(content);
    const bucketUrlPrefix = this.s3Service.getPublicUrl('');
    const escapedPrefix = bucketUrlPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const urlPattern = new RegExp(`${escapedPrefix}[^"'\\s)\\\\]+`, 'g');

    const urls = text.match(urlPattern);
    if (!urls || urls.length === 0) return [];

    const s3Keys = [
      ...new Set(urls.map((url) => this.s3Service.extractKeyFromUrl(url)))
    ];

    return await this.fileAttachmentRepository.findFileIdsByS3Keys(
      s3Keys,
      workspaceId
    );
  }

  /**
   * 노드 content의 파일 참조와 file_attachments 테이블을 diff-sync 합니다.
   * 새로 참조된 파일은 ACTIVE로, 참조가 모두 사라진 파일은 ORPHAN으로 전이합니다.
   */
  async syncNodeAttachments(
    nodeId: string,
    workspaceId: string,
    content: unknown
  ): Promise<void> {
    const referencedIds = await this.extractReferencedFileIds(
      content,
      workspaceId
    );
    const currentIds =
      await this.fileAttachmentRepository.findAttachedFileIdsByNodeId(nodeId);

    const currentSet = new Set(currentIds);
    const referencedSet = new Set(referencedIds);
    const toAdd = referencedIds.filter((id) => !currentSet.has(id));
    const toRemove = currentIds.filter((id) => !referencedSet.has(id));

    if (toAdd.length > 0) {
      await this.fileAttachmentRepository.createAttachments(nodeId, toAdd);
      await this.fileAttachmentRepository.markFilesActive(toAdd);
    }

    if (toRemove.length > 0) {
      await this.fileAttachmentRepository.deleteAttachments(nodeId, toRemove);
      await this.orphanUnreferencedFiles(toRemove);
    }

    if (toAdd.length > 0 || toRemove.length > 0) {
      this.logger.log(
        `Attachments synced for node ${nodeId}: +${toAdd.length} / -${toRemove.length}`
      );
    }
  }

  /**
   * 노드 삭제 시 해당 노드의 첨부를 모두 해제하고,
   * 마지막 참조였던 파일은 ORPHAN으로 전이합니다.
   * (노드는 soft delete라 DB cascade가 동작하지 않으므로 명시적으로 삭제)
   */
  async releaseNodeAttachments(nodeId: string): Promise<void> {
    const fileIds =
      await this.fileAttachmentRepository.findAttachedFileIdsByNodeId(nodeId);
    if (fileIds.length === 0) return;

    await this.fileAttachmentRepository.deleteAttachments(nodeId, fileIds);
    await this.orphanUnreferencedFiles(fileIds);

    this.logger.log(
      `Attachments released for node ${nodeId}: ${fileIds.length} file(s)`
    );
  }

  /** 잔여 참조가 0인 파일만 ORPHAN 처리합니다. */
  private async orphanUnreferencedFiles(fileIds: string[]): Promise<void> {
    const remainingCounts =
      await this.fileAttachmentRepository.countAttachmentsByFileIds(fileIds);
    const orphanIds = fileIds.filter((id) => !remainingCounts.has(id));
    if (orphanIds.length > 0) {
      await this.fileAttachmentRepository.markFilesOrphan(orphanIds);
    }
  }
}
