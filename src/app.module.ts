import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import { RequestContextMiddleware } from '@global/common/context/request-context.middleware';
import { createWinstonConsoleTransport } from '@global/common/logging/winston.console';
import { PrismaModule } from '@global/prisma/prisma.module';
import { RedisModule } from '@global/redis/redis.module';
import { MetricsModule } from '@global/common/metrics';
import { RealtimeAuthModule } from '@global/auth/realtime-auth.module';
import { YjsModule } from '@global/yjs/yjs.module';
import { WsModule } from '@domain/ws/ws.module';
import { RealtimeBusModule } from '@domain/realtime-bus/realtime-bus.module';
import { NodeContentModule } from '@domain/node-content/node-content.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    WinstonModule.forRoot({
      transports: [createWinstonConsoleTransport()]
    }),
    PrismaModule,
    RedisModule,
    MetricsModule,
    RealtimeAuthModule,
    YjsModule,
    WsModule,
    RealtimeBusModule,
    NodeContentModule
  ],
  controllers: [HealthController]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
