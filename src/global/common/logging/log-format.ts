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

export type WsLogKind =
  | 'connect'
  | 'rejected'
  | 'disconnect'
  | 'inbound'
  | 'broadcast';

export interface WsLogPayload {
  event: string;
  socketId: string;
  userId?: string | null;
  workspaceId?: string | null;
  nodeId?: string | null;
  bytes?: number;
  reason?: string;
  /** 개발 환경에서만 채운다 (바이너리는 길이로 치환된 상태) */
  payload?: unknown;
}

export function formatWsLog(kind: WsLogKind, payload: WsLogPayload): string {
  if (isProduction()) {
    return JSON.stringify({ type: `ws.${kind}`, ...payload });
  }
  const parts = [`[WS ${kind}]`, payload.event, `socket=${payload.socketId}`];
  if (payload.userId) parts.push(`user=${payload.userId}`);
  if (payload.workspaceId) parts.push(`ws=${payload.workspaceId}`);
  if (payload.nodeId) parts.push(`node=${payload.nodeId}`);
  if (payload.bytes !== undefined) parts.push(`${payload.bytes}B`);
  if (payload.reason) parts.push(`(${payload.reason})`);
  if (payload.payload !== undefined) {
    parts.push(JSON.stringify(payload.payload));
  }
  return parts.join(' ');
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
