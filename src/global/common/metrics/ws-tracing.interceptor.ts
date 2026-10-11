import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from '@nestjs/common';
import { Observable } from 'rxjs';
import tracer, { tracingEnabled } from '../../../tracing';

@Injectable()
export class WsTracingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'ws' || !tracingEnabled) return next.handle();

    // Create a separate trace per message, never a span for the socket lifetime.
    return new Observable((subscriber) => {
      const span = tracer.startSpan('websocket.event', {
        tags: {
          'resource.name': context.switchToWs().getPattern(),
          'span.kind': 'server',
          'span.type': 'web',
          'websocket.namespace': '/workspace'
        }
      });
      const scope = tracer.scope();
      try {
        const subscription = scope.activate(span, () =>
          next.handle().subscribe({
            next: (value: unknown) => {
              if (
                value &&
                typeof value === 'object' &&
                (value as { ok?: boolean }).ok === false
              ) {
                span.setTag('error', true);
                span.setTag('error.type', 'WebSocketResponseError');
              }
              scope.activate(span, () => subscriber.next(value));
            },
            error: (error: unknown) => {
              span.setTag('error', error instanceof Error ? error : true);
              scope.activate(span, () => subscriber.error(error));
            },
            complete: () => scope.activate(span, () => subscriber.complete())
          })
        );
        return () => {
          subscription.unsubscribe();
          span.finish();
        };
      } catch (error) {
        span.setTag('error', error instanceof Error ? error : true);
        span.finish();
        subscriber.error(error);
      }
    });
  }
}
