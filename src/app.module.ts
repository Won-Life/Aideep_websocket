import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import { RequestContextMiddleware } from './common/context/request-context.middleware';
import { createWinstonConsoleTransport } from './common/logging/winston.console';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { MetricsModule } from './common/metrics';
import { RealtimeAuthModule } from './auth/realtime-auth.module';
import { YjsModule } from './yjs/yjs.module';
import { WsModule } from './ws/ws.module';
import { RealtimeBusModule } from './realtime-bus/realtime-bus.module';
import { NodeContentModule } from './node-content/node-content.module';
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
