import { isProduction } from './logging.config';

export type HttpLogKind = 'request' | 'response';

export interface HttpLogPayload {
  requestId: string;
  userId: string | null;
  ip?: string;
  method: string;
  url: string;
  statusCode?: number;
  ms?: number;
}

export function formatHttpLog(
  kind: HttpLogKind,
  payload: HttpLogPayload
): string {
  if (isProduction()) {
    return JSON.stringify({ type: kind, ...payload });
  }
  if (kind === 'request') {
    return `[Request] userId : ${payload.userId} ${payload.method} ${payload.url}`;
  }
  return `[Response] ${payload.method} ${payload.url} ${payload.statusCode} - ${payload.ms}ms`;
}

export type PrismaLogKind = 'query' | 'slow' | 'error';

export interface PrismaLogPayload {
  label: string;
  ms: number;
  requestId?: string;
  userId?: string | null;
  inTransaction: boolean;
  code?: string;
  message?: string;
}

export function formatPrismaLog(
  kind: PrismaLogKind,
  payload: PrismaLogPayload
): string {
  if (isProduction()) {
    return JSON.stringify({ type: `prisma.${kind}`, ...payload });
  }
  const meta = {
    requestId: payload.requestId,
    userId: payload.userId,
    inTransaction: payload.inTransaction
  };
  const metaStr = JSON.stringify(meta);
  const ms = payload.ms.toFixed(2);
  if (kind === 'query') {
    return `[${payload.label}] ${ms}ms ${metaStr}`;
  }
  if (kind === 'slow') {
    return `Slow query: ${payload.label} - ${ms}ms ${metaStr}`;
  }
  return `Query failed: ${payload.label} - ${ms}ms code=${payload.code} ${metaStr} :: ${payload.message}`;
}
