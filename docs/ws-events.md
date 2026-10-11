# Aideep WebSocket 이벤트 명세

이 문서는 `aideep-websocket-server` 가 **서버 → 클라이언트로 발행(emit)하는 모든 이벤트**를 정리한 것입니다.
클라이언트가 서버로 보내는 이벤트(수신 핸들러)는 대응 관계를 알 수 있도록 함께 표기했습니다.

- 전송: Socket.IO, namespace **`/workspace`**
- 인증: handshake `auth.token` (없으면 `query.token`) 의 JWT. `payload.user_id` 가 userId.
  - 토큰 없음 / `user_id` 없음 / 검증 실패 → **즉시 `disconnect()`** (별도 에러 이벤트 발행 없음)
- 소스: `src/domain/ws/controller/ws.gateway.ts`, `src/domain/ws/type/ws.event.ts`,
  `src/global/yjs/yjs.constants.ts`, `src/domain/event-bus/*`

---

## 1. Room 구조

| room               | 생성 시점                       | 용도                                 |
| ------------------ | ------------------------------- | ------------------------------------ |
| `user:<userId>`    | 연결 직후 자동 join             | 에코 억제(발신자 제외)용 타깃        |
| `<workspaceId>`    | `join_workspace`                | 워크스페이스 단위 팬아웃             |
| `yjs:ws:<wsId>`    | `join_workspace`                | 워크스페이스 레벨 awareness          |
| `yjs:<nodeId>`     | `yjs:join`                      | 노드(문서) 레벨 Yjs sync/awareness   |

---

## 2. 서버 → 클라이언트 이벤트 (총 7종)

| 이벤트명             | 수신 대상                                   | 트리거                                               |
| -------------------- | ------------------------------------------- | ---------------------------------------------------- |
| `workspace_event`    | `<workspaceId>` room (타입에 따라 발신자 제외) | Redis event-bus `WORKSPACE_EVENT`                 |
| `presence_state`     | `<workspaceId>` room 전원                   | `join_workspace`, 연결 해제                          |
| ~~`cursor_move`~~    | –                                           | **비활성화** (§4 참고)                               |
| ~~`cursor_leave`~~   | –                                           | **비활성화** (§4 참고)                               |
| `node_position_live` | `<workspaceId>` room, 발신자 제외           | 클라이언트 `node_position_live`                      |
| `yjs:sync`           | 요청자 1명 또는 `yjs:<nodeId>` room         | `yjs:join`, `yjs:sync`, event-bus `YJS_UPDATE`, 서버 저장 |
| `yjs:awareness`      | `yjs:<nodeId>` room, 발신자 제외            | 클라이언트 `yjs:awareness`                           |
| `yjs:ws:awareness`   | `yjs:ws:<wsId>` room(제외) 또는 요청자 1명  | 클라이언트 `yjs:ws:awareness`, `join_workspace`(late joiner) |

---

## 3. `workspace_event`

Redis 채널 `aideep.realtime.v1` 로 들어온 `kind: 'WORKSPACE_EVENT'` 봉투의 `payload` 를
**그대로** 워크스페이스 room 에 흘려보냅니다.

```ts
// 봉투 (API 서버 ↔ WS 서버 계약, event-bus.contract.ts)
{
  v: 1,
  kind: 'WORKSPACE_EVENT' | 'YJS_UPDATE',
  messageId: string,
  publishedAt: string,
  origin: string,
  payload: WsEvent | YjsUpdatePayload
}
```

규칙:

- `payload.type` 화이트리스트는 **없습니다**. 모르는 type 도 그대로 전달 → 백엔드가 타입을 먼저 배포 가능.
- `ECHO_SUPPRESSED_TYPES` 에 속한 type 은 `payload.userId` 의 `user:<id>` room 을 제외해 전송
  (FE 낙관적 업데이트 중복 방지). 그 밖의 type 은 room 전원에게 전달.
- 다중 인스턴스 중복 전송을 막기 위해 `server.local.to(...)` 로 자기 인스턴스 소켓에만 emit.
- `type === 'NODE_DELETE'` 면 전송 후 해당 노드의 Yjs doc 을 정리(`cleanupNode`).

### 3.1 노드 / 엣지 이벤트 (에코 억제 대상)

`userId` = 그 동작을 수행한 사람. 이 사람은 수신 대상에서 제외됩니다.

| type          | 추가 필드                                                                 |
| ------------- | ------------------------------------------------------------------------- |
| `NODE_CREATE` | `node: { nodeId, title, nodeType, position:{x,y}, data, createdAt }`      |
| `NODE_UPDATE` | `nodeId`, `patch: { title?, position?, data?, nodeType? }`                |
| `NODE_MOVE`   | `nodeId`, `x`, `y`                                                        |
| `NODE_DELETE` | `nodeId`                                                                  |
| `EDGE_CREATE` | `edge: { edgeId, sourceId, targetId, sourceHandle, targetHandle }`        |
| `EDGE_UPDATE` | `edgeId`, `patch: { sourceHandle?, targetHandle? }`                       |
| `EDGE_DELETED`| `edgeId`  ← 과거형 표기 주의 (`EDGE_DELETE` 아님)                          |

공통 필드: `type`, `workspaceId`, `userId`.

```ts
// 예: NODE_MOVE
{ type: 'NODE_MOVE', workspaceId: 'ws-1', userId: 'u-1', nodeId: 'n-1', x: 120, y: 340 }
```

### 3.2 회의 봇 이벤트 (전원 전달)

Spring 백엔드가 Recall 웹훅을 받아 발행합니다. 여기서 `userId` 는 **봇을 초대한 사람**이지
발신자가 아니므로 **에코 억제 대상이 아니며 room 전원에게 전달**됩니다.

공통 필드: `type`, `workspaceId`, `userId`, `meetingId`, `nodeId`, `botId`, `status`, `occurredAt`.

| type                    | 의미                                   | 추가 필드                        |
| ----------------------- | -------------------------------------- | -------------------------------- |
| `MEETING_BOT_REQUESTED` | 봇 초대 요청 접수 / Recall 봇 생성됨   | –                                |
| `MEETING_BOT_JOINED`    | 봇이 회의 입장, 녹음 시작              | –                                |
| `MEETING_BOT_LEFT`      | 회의 종료, 전사 결과 준비 완료         | –                                |
| `MEETING_BOT_FAILED`    | 봇 실패                                | `statusSubCode` (Recall 원문 사유) |

```ts
{
  type: 'MEETING_BOT_JOINED',
  workspaceId: 'ws-1', userId: 'u-1',
  meetingId: 'm-1', nodeId: 'n-1', botId: 'bot-1',
  status: 'JOINED', occurredAt: '2026-10-10T04:00:00.000Z'
}
```

> 상태 판정과 "최초 전이 1회" 보장은 백엔드 책임입니다. WS 서버는 저장/재생하지 않으므로
> 구독자가 없던 동안의 누락은 FE 가 조회 API 로 복구합니다.

---

## 4. Presence / 커서 이벤트

### `presence_state`

워크스페이스 참여자 전체 스냅샷. Redis 해시에서 읽어 **room 전원**에게 보냅니다.
발행 시점: `join_workspace` 성공 직후, 그리고 멤버의 연결 해제 직후.

```ts
{
  workspaceId: string,
  members: Array<{ userId: string; userName: string; color: string; profile: string | null }>
}
```

### `cursor_move` — 비활성화

커서 공유는 현재 제품에서 쓰지 않아 **서버 릴레이를 중단**했습니다.
`@SubscribeMessage('cursor_move')` 핸들러는 남겨둬 구버전 FE 가 보내는 이벤트를
받아 삼키지만(unhandled event 로 쌓이지 않게), 아무에게도 emit 하지 않습니다.

재개 방법: `ws.gateway.ts` 의 `handleCursorMove` 안 emit 블록과
`handleDisconnect` 의 `cursor_leave` emit, 두 군데 주석을 함께 해제합니다.

```ts
// 재개 시 payload (서버가 userId 주입)
{ userId: string, workspaceId: string, x: number, y: number, userName: string, color: string }
```

### `cursor_leave` — 비활성화

연결 해제 시 발행하던 이벤트입니다. 위와 함께 중단됐습니다.
presence 정리(`removePresence`)와 `presence_state` 재브로드캐스트는 **그대로 동작**하므로
참여자 목록에서 빠지는 것은 여전히 FE 에 전달됩니다.

```ts
{ userId: string | undefined }
```

### `node_position_live`

드래그 중 좌표 중계. 수신한 payload 를 **가공 없이** 발신자 제외 릴레이.

```ts
{ workspaceId: string, nodeId: string, x: number, y: number }
```

---

## 5. Yjs 이벤트

이벤트명 상수는 `@global/yjs/yjs.constants` 의 `YJS_EVENT` / `YJS_WS_EVENT` 입니다.
바이너리는 전부 `number[]`(= `Array.from(Uint8Array)`) 로 직렬화해 보냅니다.

### `yjs:sync`

| 발행 경로                     | 수신 대상           | 내용                                             |
| ----------------------------- | ------------------- | ------------------------------------------------ |
| `yjs:join` 응답               | 요청자 1명          | **SyncStep1** (서버 state vector)                |
| `yjs:sync` 수신 후 응답       | 요청자 1명          | **SyncStep2** (인코더에 쓸 내용이 있을 때만)     |
| `yjs:sync` update(type 2) 중계| `yjs:<nodeId>` 제외 | 받은 update 원문                                 |
| `broadcastYjsUpdate()`        | `yjs:<nodeId>` 전원 | `writeUpdate` 로 감싼 update                     |

```ts
{ nodeId: string, data: number[] }
```

- `broadcastYjsUpdate()` 호출 주체: event-bus `kind: 'YJS_UPDATE'`(payload `{ nodeId, updateBase64 }`),
  그리고 `NodeContentService` 의 서버측 문서 반영.
- **VIEWER 권한**(`membership.role === 'VIEWER'`)의 update 는 중계하지 않고 버립니다(저장도 안 함).
- update 중계 시 `scheduleSave(nodeId, userId)` 로 디바운스 저장이 걸립니다.

### `yjs:awareness`

노드 레벨 awareness. 받은 payload 를 그대로 `yjs:<nodeId>` room(발신자 제외)에 릴레이. 캐싱 없음.

```ts
{ nodeId: string, data: number[] }
```

### `yjs:ws:awareness`

워크스페이스 레벨 awareness.

- 릴레이: `client.data.workspaceId === payload.workspaceId` 일 때만 `yjs:ws:<wsId>` room(발신자 제외)에 전달.
- 캐싱: Redis 에 30초 TTL(`WS_AWARENESS_TTL_SEC`)로 저장.
- **Late joiner**: `join_workspace` 시 캐시가 있으면 요청자에게 1회 단건 발행.

```ts
{ workspaceId: string, data: number[] }
```

---

## 6. 클라이언트 → 서버 이벤트와 ACK

ACK(핸들러 반환값)는 Socket.IO 콜백으로 전달됩니다.

| 이벤트               | payload                                           | ACK                                               |
| -------------------- | ------------------------------------------------- | ------------------------------------------------- |
| `join_workspace`     | `{ workspaceId, userName, color, profile? }`      | `{ ok: true }` / `{ ok: false, error }`           |
| `node_position_live` | `{ workspaceId, nodeId, x, y }`                   | 없음                                              |
| `cursor_move`        | `{ workspaceId, x, y, userName, color }`          | 없음 (**비활성화** — 릴레이 안 함)                |
| `yjs:join`           | `{ nodeId }`                                      | `{ ok: true, readOnly }` / `{ ok: false, error }` |
| `yjs:sync`           | `{ nodeId, data }`                                | 없음                                              |
| `yjs:awareness`      | `{ nodeId, data }`                                | 없음                                              |
| `yjs:leave`          | `{ nodeId }`                                      | 없음                                              |
| `yjs:ws:awareness`   | `{ workspaceId, data }`                           | 없음                                              |

ACK 에러 문구:

- `'로그인이 필요합니다.'` — `client.data.userId` 없음
- `'워크스페이스 멤버가 아닙니다'` — 멤버십 조회 실패
- `'join_workspace 먼저 호출하세요'` — `yjs:join` 전에 워크스페이스 미참여

---

## 7. 이벤트 추가 시 체크리스트

1. `src/domain/ws/type/ws.event.ts` 에 인터페이스 추가 → `WsEvent` union 에 등록.
2. 발신자 에코를 막아야 하면 `ECHO_SUPPRESSED_TYPES` 에 type 문자열 추가.
   (추가하지 않으면 기본값은 **room 전원 전달**)
3. `event-bus.contract.ts` 는 `Aideep_backend` 와의 공유 계약 사본 → **양쪽 함께 갱신**.
4. 새 Socket.IO 이벤트명은 `@global/yjs/yjs.constants` 처럼 상수로 모아두기.
5. 테스트는 `test/ws/` 또는 `test/event-bus/` 에 추가.
