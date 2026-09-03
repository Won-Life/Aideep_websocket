import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from './common/error';
import { ResponseInterceptor } from './common/response/response.interceptor';
import { LoggingInterceptor } from './common/logging/logging.interceptor';
import { HttpMetricsInterceptor } from './common/metrics';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const winstonLogger = app.get(WINSTON_MODULE_NEST_PROVIDER);

  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalFilters(new AllExceptionsFilter(winstonLogger));
  app.useGlobalInterceptors(
    new LoggingInterceptor(winstonLogger),
    app.get(HttpMetricsInterceptor),
    new ResponseInterceptor()
  );
  app.enableCors();
  app.useLogger(winstonLogger);
  app.setGlobalPrefix('aideep/api', { exclude: ['/metrics', '/healthz'] });

  await app.listen(process.env.PORT ?? 3321);
}
bootstrap();
