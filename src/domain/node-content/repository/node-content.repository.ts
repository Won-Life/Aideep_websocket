import { Injectable } from '@nestjs/common';
import { PrismaService } from '@global/prisma/prisma.service';

/**
 * Aideep_backend/src/node/node.repository.ts 의 selectNodeById만 옮긴 축소 리포지토리입니다.
 * content operation은 content / version만 필요합니다.
 */
@Injectable()
export class NodeContentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async selectNodeById(workspaceId: string, nodeId: string) {
    return await this.prisma.client.nodes.findFirst({
      select: {
        content: true,
        version: true
      },
      where: { node_id: nodeId, workspace_id: workspaceId, deleted_at: null }
    });
  }
}
