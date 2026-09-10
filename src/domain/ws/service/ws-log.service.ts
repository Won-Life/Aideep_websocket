import { Injectable, Logger } from '@nestjs/common';
import { Socket } from 'socket.io';
import { WsLogPayload, formatWsLog } from '@global/common/logging/log-format';
import { isProduction } from '@global/common/logging/logging.config';
import { YJS_EVENT, YJS_WS_EVENT } from '@global/yjs/yjs.constants';

/** 초당 수십 건 발생하는 이벤트 — verbose 로 낮춰 prod(info) 에서는 남기지 않는다 */
const HIGH_FREQUENCY_EVENTS = new Set<string>([
  'node_position_live',
  'cursor_move',
  YJS_EVENT.SYNC,
  YJS_EVENT.AWARENESS,
  YJS_WS_EVENT.AWARENESS
]);

/** Yjs 페이로드는 원소 수천 개짜리 number[] 라 그대로 찍으면 로그가 폭발한다 */
const isBinaryLike = (value: unknown): boolean =>
  Buffer.isBuffer(value) ||
  value instanceof Uint8Array ||
  (Array.isArray(value) && typeof value[0] === 'number');

const byteSize = (value: unknown): number | undefined => {
  if (value === null || value === undefined) return undefined;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return value.byteLength;
  }
  if (Array.isArray(value)) return value.length;
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '');
  } catch {
    return undefined;
  }
};

/** 바이너리 필드를 길이 표기로 치환한 얕은 복사본 */
const redactBinary = (payload: unknown): unknown => {
  if (isBinaryLike(payload)) return `<binary ${byteSize(payload)}B>`;
  if (payload === null || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) return payload;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    result[key] = isBinaryLike(value) ? `<binary ${byteSize(value)}B>` : value;
  }
  return result;
};

const pick = (payload: unknown, key: string): string | null => {
  if (payload === null || typeof payload !== 'object') return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
};

@Injectable()
export class WsLogService {
  private readonly logger = new Logger('WS');

  connect(client: Socket): void {
    this.logger.log(
      formatWsLog('connect', {
        event: 'connection',
        socketId: client.id,
        userId: client.data?.userId ?? null
      })
    );
  }

  rejected(client: Socket, reason: string): void {
    this.logger.warn(
      formatWsLog('rejected', {
        event: 'connection',
        socketId: client.id,
        reason
      })
    );
  }

  disconnect(client: Socket): void {
    this.logger.log(
      formatWsLog('disconnect', {
        event: 'disconnect',
        socketId: client.id,
        userId: client.data?.userId ?? null,
        workspaceId: client.data?.workspaceId ?? null
      })
    );
  }

  inbound(client: Socket, event: string, payload: unknown): void {
    const highFrequency = HIGH_FREQUENCY_EVENTS.has(event);
    // prod 에서 고빈도 이벤트는 어차피 버려지므로 요약 계산조차 하지 않는다
    if (highFrequency && isProduction()) return;

    this.write(highFrequency, 'inbound', {
      event,
      socketId: client.id,
      userId: client.data?.userId ?? null,
      workspaceId: pick(payload, 'workspaceId') ?? client.data?.workspaceId,
      nodeId: pick(payload, 'nodeId'),
      bytes: byteSize(payload),
      payload: isProduction() ? undefined : redactBinary(payload)
    });
  }

  broadcast(
    event: string,
    meta: Omit<WsLogPayload, 'event' | 'socketId'>
  ): void {
    const highFrequency = HIGH_FREQUENCY_EVENTS.has(event);
    if (highFrequency && isProduction()) return;

    this.write(highFrequency, 'broadcast', {
      ...meta,
      event,
      socketId: 'server'
    });
  }

  private write(
    highFrequency: boolean,
    kind: 'inbound' | 'broadcast',
    payload: WsLogPayload
  ): void {
    const line = formatWsLog(kind, payload);
    if (highFrequency) {
      this.logger.verbose(line);
      return;
    }
    this.logger.log(line);
  }
}
