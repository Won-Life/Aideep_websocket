import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { EmbedQueueService } from './embed-queue.service';

@Global()
@Module({
  providers: [RedisService, EmbedQueueService],
  exports: [RedisService, EmbedQueueService]
})
export class RedisModule {}
