import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';
import { REDIS_KEYS } from './redis.keys';

export interface EmbedJobPayload {
  nodeId: string;
  userId: string;
  workspaceId: string;
}

@Injectable()
export class EmbedQueueService {
  private readonly logger = new Logger(EmbedQueueService.name);

  constructor(private readonly redisService: RedisService) {}

  async enqueueEmbedJob(payload: EmbedJobPayload): Promise<void> {
    try {
      await this.redisService
        .getClient()
        .rPush(REDIS_KEYS.EMBED_JOBS_QUEUE, JSON.stringify(payload));
    } catch (err) {
      this.logger.error(
        `embed job enqueue failed: nodeId=${payload.nodeId}`,
        err
      );
    }
  }
}
