import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Histogram } from 'prom-client';
import { Request, Response } from 'express';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(
    @InjectMetric('http_request_duration_seconds')
    private readonly httpDuration: Histogram,
    @InjectMetric('http_requests_total')
    private readonly httpTotal: Counter
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // WS 이벤트는 무시
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const method = req.method;
    const route = req.route?.path ?? req.path;
    const end = this.httpDuration.startTimer({ method, route });

    return next.handle().pipe(
      tap({
        next: () => {
          const status = String(res.statusCode);
          end({ status });
          this.httpTotal.inc({ method, route, status });
        },
        error: () => {
          const status = String(res.statusCode >= 400 ? res.statusCode : 500);
          end({ status });
          this.httpTotal.inc({ method, route, status });
        }
      })
    );
  }
}
