import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Gauge } from 'prom-client';

@Injectable()
export class WsMetricsService {
  constructor(
    @InjectMetric('ws_connections_active')
    private readonly wsConnections: Gauge
  ) {}

  increment(): void {
    this.wsConnections.inc();
  }

  decrement(): void {
    this.wsConnections.dec();
  }
}
