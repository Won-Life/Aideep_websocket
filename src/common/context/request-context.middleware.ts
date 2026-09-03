import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requestContextStorage } from './request.context';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.headers['x-request-id'];
    const requestId =
      (typeof incoming === 'string' && incoming.length > 0
        ? incoming
        : Array.isArray(incoming)
          ? incoming[0]
          : null) ?? uuidv4();

    res.setHeader('X-Request-Id', requestId);

    requestContextStorage.run({ requestId, userId: null }, () => next());
  }
}
