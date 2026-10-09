// ──────────────────────────────────────────
// 이벤트 타입 정의
// ──────────────────────────────────────────
interface WsEventBase {
  type: string;
  workspaceId: string;
}

export interface NodeMoveEvent extends WsEventBase {
  type: 'NODE_MOVE';
  userId: string;
  nodeId: string;
  x: number;
  y: number;
}

export interface NodeCreateEvent extends WsEventBase {
  type: 'NODE_CREATE';
  userId: string;
  node: {
    nodeId: string;
    title: string;
    nodeType: string;
    position: { x: number; y: number };
    data: Record<string, unknown>;
    createdAt: string;
  };
}

export interface NodeDeleteEvent extends WsEventBase {
  type: 'NODE_DELETE';
  userId: string;
  nodeId: string;
}

export interface NodeUpdateEvent extends WsEventBase {
  type: 'NODE_UPDATE';
  nodeId: string;
  userId: string;
  patch: {
    title?: string;
    position?: { x: number; y: number };
    data?: Record<string, unknown>;
    nodeType?: string;
  };
}

export interface EdgeCreateEvent extends WsEventBase {
  type: 'EDGE_CREATE';
  userId: string;
  edge: {
    edgeId: string;
    sourceId: string;
    targetId: string;
    sourceHandle: string;
    targetHandle: string;
  };
}
export interface EdgeDeleteEvent extends WsEventBase {
  type: 'EDGE_DELETED';
  userId: string;
  edgeId: string;
}

export interface EdgeUpdateEvent extends WsEventBase {
  type: 'EDGE_UPDATE';
  userId: string;
  edgeId: string;
  patch: {
    sourceHandle?: string;
    targetHandle?: string;
  };
}

// ──────────────────────────────────────────
// 회의 봇 이벤트 (Spring 백엔드가 Recall 웹훅을 받아 발행)
// 상태 판정·최초 전이 1회 보장은 백엔드 책임. WS 서버는 그대로 전달만 한다.
// ──────────────────────────────────────────
interface MeetingBotEventBase extends WsEventBase {
  /** 봇을 초대한 사용자. 수신자 필터가 아니라 "누가 시작했는지" 표시용이다 */
  userId: string;
  meetingId: string;
  nodeId: string;
  botId: string;
  status: string;
  occurredAt: string;
}

/** 사용자가 봇 초대를 요청했고 Recall 봇이 생성됨 */
export interface MeetingBotRequestedEvent extends MeetingBotEventBase {
  type: 'MEETING_BOT_REQUESTED';
}

/** 봇이 회의에 들어가 녹음을 시작함 */
export interface MeetingBotJoinedEvent extends MeetingBotEventBase {
  type: 'MEETING_BOT_JOINED';
}

/** 회의가 끝나고 전사 결과까지 준비됨 */
export interface MeetingBotLeftEvent extends MeetingBotEventBase {
  type: 'MEETING_BOT_LEFT';
}

/** 봇이 실패함. statusSubCode 에 Recall 원문 사유 */
export interface MeetingBotFailedEvent extends MeetingBotEventBase {
  type: 'MEETING_BOT_FAILED';
  statusSubCode: string;
}

export type MeetingBotEvent =
  | MeetingBotRequestedEvent
  | MeetingBotJoinedEvent
  | MeetingBotLeftEvent
  | MeetingBotFailedEvent;

export interface CursorMoveEvent {
  userId: string;
  workspaceId: string;
  x: number;
  y: number;
  userName: string;
  color: string;
}

export interface CursorLeaveEvent {
  userId: string;
}

export interface PresenceMember {
  userId: string;
  userName: string;
  color: string;
  profile: string | null;
}

export interface PresenceStateEvent {
  workspaceId: string;
  members: PresenceMember[];
}

// 이벤트 추가 시 여기에 union으로 추가

export type WsEvent =
  | NodeMoveEvent
  | NodeCreateEvent
  | NodeDeleteEvent
  | NodeUpdateEvent
  | EdgeCreateEvent
  | EdgeDeleteEvent
  | EdgeUpdateEvent
  | MeetingBotEvent;

/**
 * 발신자 본인에게 되돌려 보내지 않는(에코 억제) 이벤트 타입.
 *
 * 노드·엣지 이벤트는 FE 가 낙관적 업데이트로 화면에 이미 반영했기 때문에 `userId`(= 그 동작을 한 사람)를
 * 제외해야 중복 렌더가 없다. 반면 회의 이벤트의 `userId` 는 "봇을 초대한 사람"일 뿐 발신자가 아니므로
 * 억제 대상이 아니다 — 워크스페이스 room 전원에게 보낸다.
 *
 * 목록에 없는 타입(백엔드가 먼저 배포한 미지의 타입 포함)은 전원 전달이 기본값이다.
 */
export const ECHO_SUPPRESSED_TYPES = new Set<string>([
  'NODE_MOVE',
  'NODE_CREATE',
  'NODE_DELETE',
  'NODE_UPDATE',
  'EDGE_CREATE',
  'EDGE_DELETED',
  'EDGE_UPDATE'
]);
