import { Controller, Get } from '@nestjs/common';
import { Namespace } from 'socket.io';
import { WsGateway } from '@domain/ws/controller/ws.gateway';

@Controller('healthz')
export class HealthController {
  constructor(private readonly wsGateway: WsGateway) {}

  @Get()
  check() {
    // 네임스페이스 게이트웨이라 @WebSocketServer()에는 Namespace가 주입된다
    const namespace = this.wsGateway.server as unknown as Namespace | undefined;
    return {
      status: 'ok',
      sockets: namespace?.sockets.size ?? 0
    };
  }
}
