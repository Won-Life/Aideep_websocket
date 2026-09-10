// ⚠️ Aideep_backend/src/realtime-bus/realtime-bus.contract.ts 의 사본입니다.
//    API 서버(추후 Spring)와 실시간 서버 사이의 유일한 계약이므로 양쪽을 함께 갱신해야 합니다.
import { WsEvent } from '@domain/ws/type/ws.event';

export { WsEvent };

export const REALTIME_CHANNEL = 'aideep.realtime.v1';
export const REALTIME_CONTRACT_VERSION = 1;

export type RealtimeKind = 'WORKSPACE_EVENT' | 'YJS_UPDATE';

/** kind === 'YJS_UPDATE' 의 payload. update는 raw Y.encodeStateAsUpdate 결과의 base64 */
export interface YjsUpdatePayload {
  nodeId: string;
  updateBase64: string;
}

export interface RealtimeEnvelope {
  v: number;
  kind: RealtimeKind;
  messageId: string;
  publishedAt: string;
  origin: string;
  payload: WsEvent | YjsUpdatePayload;
}
