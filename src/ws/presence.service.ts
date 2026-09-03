import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import { REDIS_KEYS } from 'src/redis/redis.keys';
import { PresenceMember } from './ws.event';

const WS_PRESENCE_TTL_SEC = 60 * 60 * 24;

@Injectable()
export class PresenceService {
  constructor(private readonly redisService: RedisService) {}

  async upsertPresence(
    workspaceId: string,
    member: PresenceMember
  ): Promise<void> {
    const key = REDIS_KEYS.WS_PRESENCE(workspaceId);
    const client = this.redisService.getClient();
    await client.hSet(key, member.userId, JSON.stringify(member));
    await client.expire(key, WS_PRESENCE_TTL_SEC);
  }

  async removePresence(workspaceId: string, userId: string): Promise<void> {
    await this.redisService
      .getClient()
      .hDel(REDIS_KEYS.WS_PRESENCE(workspaceId), userId);
  }

  async listPresence(workspaceId: string): Promise<PresenceMember[]> {
    const raw = await this.redisService
      .getClient()
      .hGetAll(REDIS_KEYS.WS_PRESENCE(workspaceId));
    return Object.values(raw).map((s) => JSON.parse(s) as PresenceMember);
  }
}
