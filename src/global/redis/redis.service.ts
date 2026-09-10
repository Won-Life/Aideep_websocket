import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

export function getRedisOptions() {
  const host = process.env.REDIS_HOST;
  const port = Number(process.env.REDIS_PORT);
  if (!host || !Number.isFinite(port)) {
    throw new Error(
      `[Redis] Invalid env: REDIS_HOST=${host}, REDIS_PORT=${process.env.REDIS_PORT}`
    );
  }
  return {
    socket: { host, port },
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD
  };
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType;
  private readonly subscribers: RedisClientType[] = [];

  async onModuleInit() {
    this.client = createClient(getRedisOptions()) as RedisClientType;

    this.client.on('error', (err) =>
      console.error('[Infrastructure] Redis Connection Error:', err)
    );
    this.client.on('connect', () =>
      console.log('[Infrastructure] Redis Connection Success')
    );

    await this.client.connect();
  }

  async onModuleDestroy() {
    for (const subscriber of this.subscribers) {
      await subscriber.quit();
    }
    await this.client.quit();
  }

  getClient(): RedisClientType {
    return this.client;
  }

  /**
   * 구독 전용 커넥션을 만듭니다. subscribe 모드의 커넥션은 일반 커맨드를 받을 수 없으므로
   * 메인 클라이언트를 복제해서 씁니다. duplicate()는 미연결 클라이언트를 반환하므로 connect()가 필요합니다.
   */
  async createSubscriber(label: string): Promise<RedisClientType> {
    const subscriber = this.client.duplicate() as RedisClientType;
    subscriber.on('error', (err) =>
      console.error(`[Infrastructure] Redis Subscriber(${label}) Error:`, err)
    );
    await subscriber.connect();
    this.subscribers.push(subscriber);
    return subscriber;
  }
}
