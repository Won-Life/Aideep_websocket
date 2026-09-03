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
  | EdgeUpdateEvent;
