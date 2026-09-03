import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { file_status_enum } from 'src/generated/prisma/client';

@Injectable()
export class FileAttachmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findFileIdsByS3Keys(
    s3Keys: string[],
    workspaceId: string
  ): Promise<string[]> {
    const files = await this.prisma.client.files.findMany({
      where: {
        s3_key: { in: s3Keys },
        workspace_id: workspaceId,
        deleted_at: null
      },
      select: { file_id: true }
    });
    return files.map((f) => f.file_id);
  }

  async findAttachedFileIdsByNodeId(nodeId: string): Promise<string[]> {
    const attachments = await this.prisma.client.file_attachments.findMany({
      where: { node_id: nodeId },
      select: { file_id: true }
    });
    return attachments.map((a) => a.file_id);
  }

  async createAttachments(nodeId: string, fileIds: string[]): Promise<void> {
    await this.prisma.client.file_attachments.createMany({
      data: fileIds.map((fileId) => ({ file_id: fileId, node_id: nodeId })),
      skipDuplicates: true
    });
  }

  async deleteAttachments(nodeId: string, fileIds: string[]): Promise<void> {
    await this.prisma.client.file_attachments.deleteMany({
      where: { node_id: nodeId, file_id: { in: fileIds } }
    });
  }

  /** 파일별 잔여 참조(첨부) 수를 반환합니다. 참조가 없는 파일은 결과에 포함되지 않습니다. */
  async countAttachmentsByFileIds(
    fileIds: string[]
  ): Promise<Map<string, number>> {
    const counts = await this.prisma.client.file_attachments.groupBy({
      by: ['file_id'],
      where: { file_id: { in: fileIds } },
      _count: { file_id: true }
    });
    return new Map(counts.map((c) => [c.file_id, c._count.file_id]));
  }

  async markFilesActive(fileIds: string[]): Promise<void> {
    await this.prisma.client.files.updateMany({
      where: { file_id: { in: fileIds } },
      data: {
        status: file_status_enum.ACTIVE,
        orphaned_at: null,
        updated_at: new Date()
      }
    });
  }

  async markFilesOrphan(fileIds: string[]): Promise<void> {
    await this.prisma.client.files.updateMany({
      where: { file_id: { in: fileIds } },
      data: {
        status: file_status_enum.ORPHAN,
        orphaned_at: new Date(),
        updated_at: new Date()
      }
    });
  }

  async markFilesDeleted(fileIds: string[]): Promise<void> {
    await this.prisma.client.files.updateMany({
      where: { file_id: { in: fileIds } },
      data: { status: file_status_enum.DELETED, updated_at: new Date() }
    });
  }

  /**
   * GC 대상 파일을 조회합니다.
   * 1) ORPHAN 상태로 threshold 이전에 orphan 처리된 파일
   * 2) PENDING 상태로 threshold 이전에 업로드된 후 어떤 노드에도 첨부되지 않은 파일
   */
  async findStaleFiles(
    threshold: Date
  ): Promise<{ file_id: string; s3_key: string }[]> {
    return await this.prisma.client.files.findMany({
      where: {
        deleted_at: null,
        OR: [
          {
            status: file_status_enum.ORPHAN,
            orphaned_at: { lt: threshold }
          },
          {
            status: file_status_enum.PENDING,
            created_at: { lt: threshold }
          }
        ]
      },
      select: { file_id: true, s3_key: true }
    });
  }
}
