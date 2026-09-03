import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import { REDIS_KEYS } from 'src/redis/redis.keys';
import { WS_AWARENESS_TTL_SEC } from './yjs.constants';

/**
 * 워크스페이스 레벨 awareness 상태를 Redis에 캐싱.
 * 늦게 접속한 유저에게 현재 presence 스냅샷을 전달하기 위해 사용.
 */
@Injectable()
export class YjsWsAwarenessService {
  private readonly logger = new Logger(YjsWsAwarenessService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * awareness 바이너리를 Redis에 캐싱 (Base64).
   * TTL은 30초 — 접속자가 주기적으로 갱신하지 않으면 자동 만료.
   */
  async cacheAwareness(
    workspaceId: string,
    data: Buffer
  ): Promise<void> {
    try {
      await this.redis
        .getClient()
        .set(
          REDIS_KEYS.YJS_WS_AWARENESS(workspaceId),
          data.toString('base64'),
          { EX: WS_AWARENESS_TTL_SEC }
        );
    } catch (err) {
      this.logger.error(
        `Failed to cache ws awareness for ${workspaceId}`,
        err
      );
    }
  }

  /**
   * 캐싱된 awareness 상태 조회 (late joiner용).
   * 없으면 null 반환.
   */
  async getCachedAwareness(
    workspaceId: string
  ): Promise<Buffer | null> {
    try {
      const data = await this.redis
        .getClient()
        .get(REDIS_KEYS.YJS_WS_AWARENESS(workspaceId));

      if (!data || typeof data !== 'string') return null;
      return Buffer.from(data, 'base64');
    } catch (err) {
      this.logger.error(
        `Failed to load ws awareness for ${workspaceId}`,
        err
      );
      return null;
    }
  }

  /**
   * 워크스페이스 awareness 캐시 삭제.
   */
  async deleteAwareness(workspaceId: string): Promise<void> {
    try {
      await this.redis
        .getClient()
        .del(REDIS_KEYS.YJS_WS_AWARENESS(workspaceId));
    } catch (err) {
      this.logger.error(
        `Failed to delete ws awareness for ${workspaceId}`,
        err
      );
    }
  }
}
