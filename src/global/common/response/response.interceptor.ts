import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { SKIP_TRANSFORM_KEY } from './skip-transform.decorator';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    if (request?.url?.startsWith('/metrics')) return next.handle();

    const skipTransform = Reflect.getMetadata(
      SKIP_TRANSFORM_KEY,
      context.getHandler()
    );
    if (skipTransform) return next.handle();

    return next.handle().pipe(
      map((data) => ({
        resultType: 'SUCCESS',
        error: null,
        success: data
      }))
    );
  }
}
