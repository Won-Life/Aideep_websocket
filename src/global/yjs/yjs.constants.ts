// ──────────────────────────────────────────
// Yjs CRDT 상수
// ──────────────────────────────────────────

/** Socket.io 이벤트명 — 노드(문서) 레벨 */
export const YJS_EVENT = {
  JOIN: 'yjs:join',
  LEAVE: 'yjs:leave',
  SYNC: 'yjs:sync',
  AWARENESS: 'yjs:awareness'
} as const;

/** Socket.io 이벤트명 — 워크스페이스 레벨 presence */
export const YJS_WS_EVENT = {
  AWARENESS: 'yjs:ws:awareness'
} as const;

/** 타이머 (ms) */
export const DEBOUNCE_SAVE_MS = 2_000;
export const SAFETY_FLUSH_INTERVAL_MS = 30_000;
export const DOC_IDLE_TIMEOUT_MS = 300_000; // 5분
export const WS_AWARENESS_TTL_SEC = 30; // 워크스페이스 awareness Redis TTL

/**
 * flushAll 이 한 번에 띄우는 flush 개수 상한.
 * interactive transaction 은 커넥션을 트랜잭션 전체 구간 동안 점유하므로,
 * 메모리에 올라온 doc 전부를 동시에 flush 하면 커넥션 풀이 고갈되고
 * DB 연결 수가 폭증한다. 풀 크기보다 작게 유지한다.
 */
export const FLUSH_CONCURRENCY = 4;

/** Socket.io room 이름 */
export const yjsRoom = (nodeId: string) => `yjs:${nodeId}`;
export const yjsWsRoom = (workspaceId: string) => `yjs:ws:${workspaceId}`;
