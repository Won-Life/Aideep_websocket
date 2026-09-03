import { Module } from '@nestjs/common';
import {
  PrometheusModule,
  makeCounterProvider,
  makeHistogramProvider,
  makeGaugeProvider
} from '@willsoto/nestjs-prometheus';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { WsMetricsService } from './ws-metrics.service';

@Module({
  imports: [
    PrometheusModule.register({
      path: '/metrics',
      defaultMetrics: { enabled: true }
    })
  ],
  providers: [
    // HTTP 메트릭
    makeHistogramProvider({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5]
    }),
    makeCounterProvider({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status']
    }),
    // WS 메트릭
    makeGaugeProvider({
      name: 'ws_connections_active',
      help: 'Number of active WebSocket connections'
    }),
    HttpMetricsInterceptor,
    WsMetricsService
  ],
  exports: [HttpMetricsInterceptor, WsMetricsService]
})
export class MetricsModule {}
