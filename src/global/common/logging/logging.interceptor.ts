import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  LoggerService,
  NestInterceptor
} from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { getRequestContext } from '../context/request.context';
import { LOG_SKIP_URLS } from './logging.config';
import { formatHttpLog } from './log-format';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER) private readonly logger: LoggerService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const { method, url } = req;

    if (LOG_SKIP_URLS.some((skip) => url.startsWith(skip))) {
      return next.handle();
    }

    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.ip;
    const userId = (req as any).user?.user_id ?? null;
    const ctx = getRequestContext();
    const requestId = ctx?.requestId ?? 'no-context';
    if (ctx) {
      ctx.userId = userId;
    }
    const start = Date.now();

    this.logger.log(
      formatHttpLog('request', { requestId, userId, ip, method, url }),
      'HTTP'
    );

    return next.handle().pipe(
      tap(() => {
        const ms = Date.now() - start;
        this.logger.log(
          formatHttpLog('response', {
            requestId,
            userId,
            ip,
            method,
            url,
            statusCode: res.statusCode,
            ms
          }),
          'HTTP'
        );
      }),
      catchError((err) => {
        const ms = Date.now() - start;
        const statusCode = err instanceof HttpException ? err.getStatus() : 500;
        const stack = err instanceof Error ? err.stack : undefined;
        this.logger.error(
          formatHttpLog('response', {
            requestId,
            userId,
            ip,
            method,
            url,
            statusCode,
            ms
          }),
          stack,
          'HTTP'
        );
        return throwError(() => err);
      })
    );
  }
}
