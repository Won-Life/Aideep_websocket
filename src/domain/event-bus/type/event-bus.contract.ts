// ⚠️ Aideep_backend/src/event-bus/event-bus.contract.ts 의 사본입니다.
//    API 서버(추후 Spring)와 실시간 서버 사이의 유일한 계약이므로 양쪽을 함께 갱신해야 합니다.
import { WsEvent } from '@domain/ws/type/ws.event';

export { WsEvent };

export const EVENT_BUS_CHANNEL = 'aideep.realtime.v1';
export const EVENT_BUS_CONTRACT_VERSION = 1;

export type EventBusKind = 'WORKSPACE_EVENT' | 'YJS_UPDATE' | 'NODE_BODY_PATCH';

/** kind === 'YJS_UPDATE' 의 payload. update는 raw Y.encodeStateAsUpdate 결과의 base64 */
export interface YjsUpdatePayload {
  nodeId: string;
  updateBase64: string;
}

/**
 * kind === 'NODE_BODY_PATCH' 의 payload. 클라이언트로 중계하지 않고 이 서버가 Y.Doc을 직접 바꾼다.
 * 본문(content.markdownBody)의 소스는 nodes.yjs_state이므로 API 서버는 "어느 노드에 무슨 본문"만 보낸다.
 * commandEventId는 재배달된 명령을 멱등하게 걸러내는 키다.
 */
export interface NodeBodyPatchPayload {
  workspaceId: string;
  nodeId: string;
  markdown: string;
  actorId: string;
  commandEventId: string;
}

export interface EventBusEnvelope {
  v: number;
  kind: EventBusKind;
  messageId: string;
  publishedAt: string;
  origin: string;
  payload: WsEvent | YjsUpdatePayload | NodeBodyPatchPayload;
}
