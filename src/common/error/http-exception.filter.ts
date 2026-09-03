import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  LoggerService
} from '@nestjs/common';
import { Response, Request } from 'express';
import { BasicError } from './basic-error';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER) private readonly logger: LoggerService
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const { method, url } = request;

    if (exception instanceof BasicError) {
      this.logger.error(
        `[Exception] ${method} ${url} ${exception.status} - ${exception.message}`,
        exception.stack,
        'ExceptionFilter'
      );
      response.status(exception.status).json(exception.toJSON());
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      let reason = exception.message;
      let data = '';

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const res = exceptionResponse as Record<string, any>;
        if (Array.isArray(res.message)) {
          reason = res.message.join(', ');
        } else if (typeof res.message === 'string') {
          reason = res.message;
        }
        data = res.error || '';
      }

      this.logger.error(
        `[Exception] ${method} ${url} ${status} - ${reason}`,
        status >= 500 ? exception.stack : undefined,
        'ExceptionFilter'
      );

      response.status(status).json({
        resultType: 'FAIL',
        error: { errorCode: `HTTP-${status}`, reason, data },
        success: null
      });
      return;
    }

    // 예상치 못한 에러 - 무조건 로깅
    this.logger.error(
      `[Exception] ${method} ${url} 500 - Unhandled exception`,
      exception instanceof Error ? exception.stack : String(exception),
      'ExceptionFilter'
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      resultType: 'FAIL',
      error: {
        errorCode: 'COMMON-500',
        reason: '서버 내부 오류가 발생했습니다.',
        data: ''
      },
      success: null
    });
  }
}
