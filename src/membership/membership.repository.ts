import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * Aideep_backend/src/workspace/workspace.repository.ts 의 checkWorkspace만 옮긴 축소 리포지토리입니다.
 * 실시간 서버는 워크스페이스 멤버십/권한 조회만 필요합니다.
 */
@Injectable()
export class MembershipRepository {
  constructor(private readonly prisma: PrismaService) {}

  async checkWorkspace(userId: string, workspaceId: string) {
    if (!userId || !workspaceId) return null;
    return await this.prisma.client.users_workspaces.findUnique({
      where: {
        user_id_workspace_id: {
          user_id: userId,
          workspace_id: workspaceId
        },
        deleted_at: null
      }
    });
  }
}
