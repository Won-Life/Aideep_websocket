# 회의 실시간 이벤트 — aideep-ws 작업 기획

이 문서는 **`aideep-ws` 저장소에서 할 작업**의 기획서다. Spring 백엔드는 Redis Pub/Sub까지만 책임지고,
WebSocket 연결·room 관리·클라이언트 전달은 전부 `aideep-ws`가 담당한다.

- 발행 측 계약: 회의 상태 실시간 전파 계약 (`Aideep_backend` 저장소 문서)
- 선례: 노드 이벤트가 이미 같은 채널·같은 room으로 전달되고 있다
  (AI-백엔드 노드 이벤트 계약, `Aideep_backend` 저장소 문서)

## 경계

| 책임 | 주체 |
|---|---|
| 회의 상태 판정, 최초 전이 1회 보장, payload 구성 | Spring 백엔드 |
| `aideep.realtime.v1` 발행 | Spring 백엔드 |
| 채널 구독, room 라우팅, Socket.IO emit, 연결·인증 관리 | **aideep-ws** |
| 이벤트 수신 후 화면 반영, 재접속 시 상태 복구 호출 | 프런트엔드 |

Spring에는 WebSocket 엔드포인트가 없고 앞으로도 두지 않는다. Spring은 다중 인스턴스로 뜨기 때문에 웹훅을 받은
인스턴스와 클라이언트가 붙어 있는 인스턴스가 다르며, Redis fan-out이 이미 그 문제를 푸는 구조다.

## 입력 — 구독해야 하는 것

- 채널: `aideep.realtime.v1` (노드 이벤트와 **공유**. 별도 채널을 새로 만들지 않는다)
- envelope: 노드 이벤트와 동일

```json
{
  "v": 1,
  "kind": "WORKSPACE_EVENT",
  "messageId": "uuid",
  "publishedAt": "2026-10-09T02:51:25.449Z",
  "origin": "spring-api",
  "payload": { "type": "MEETING_BOT_JOINED", "workspaceId": "uuid", "...": "..." }
}
```

- 회의 payload 4종

| `payload.type` | 의미 |
|---|---|
| `MEETING_BOT_REQUESTED` | 사용자가 봇 초대를 요청했고 Recall 봇이 생성됨 |
| `MEETING_BOT_JOINED` | 봇이 회의에 들어가 녹음을 시작함 |
| `MEETING_BOT_LEFT` | 회의가 끝나고 전사 결과까지 준비됨 |
| `MEETING_BOT_FAILED` | 봇이 실패함. `statusSubCode`에 Recall 원문 사유 |

공통 필드: `type`, `workspaceId`, `userId`(봇을 초대한 사용자), `meetingId`, `nodeId`, `botId`, `status`,
`occurredAt`. `MEETING_BOT_FAILED`만 `statusSubCode`가 추가된다.

payload는 자족적이다. WS 서버는 이 이벤트를 위해 DB나 백엔드 API를 조회하지 않는다.

## 출력 — 클라이언트로 내보내는 것

기존 노드 이벤트와 **같은 경로**를 쓴다. 새 namespace나 새 소켓 이벤트 이름을 만들지 않는다.

| 항목 | 값 |
|---|---|
| namespace | `/workspace` |
| room | 기존 워크스페이스 room (`payload.workspaceId` 기준) |
| 소켓 이벤트 이름 | `workspace_event` |
| 본문 | envelope의 `payload`를 그대로 |

프런트엔드는 `workspace_event` 하나를 받아 `payload.type`으로 분기한다. 회의 이벤트를 위해 FE가 새로 구독할
소켓 이벤트는 없고, `type` 분기만 추가하면 된다.

## 할 일

> **작업 결과 (WS 서버 담당자 회신)**
>
> 1번 확인 결과 **화이트리스트는 없었다** — `event-bus.subscriber.ts` 는 `envelope.kind` 만 검사하고 payload 는
> 그대로 room 에 흘린다. 다만 `broadcast()` 가 모든 이벤트에서 `payload.userId` 의 `user:<id>` room 을
> 제외하고 있어서, 회의 이벤트는 **봇을 초대한 당사자만 못 받는** 상태였다. 억제 대상을
> `ECHO_SUPPRESSED_TYPES`(노드·엣지 7종)로 좁혀 회의 이벤트와 미지의 타입은 room 전원에게 가도록 고쳤다.
> 타입 정의(`WsEvent` union)에 회의 4종을 추가했고, 2·3·4번은 코드 변경 없이 충족되며 테스트로 고정했다.

1. **투명 전달 여부 확인 (선행)**
   현재 구현이 `payload.type`을 화이트리스트로 검사하는지, 아니면 받은 payload를 그대로 room에 흘리는지
   확인한다.
   - 그대로 흘리는 구조라면 **코드 변경 없이** 회의 이벤트가 전달된다. 이 경우 작업은 2~4번(검증·문서)만 남는다.
   - 화이트리스트가 있다면 `MEETING_BOT_REQUESTED`/`JOINED`/`LEFT`/`FAILED` 4개를 추가한다.
2. **라우팅 키 확인**: 회의 payload는 `workspaceId`를 **최상위**에 둔다. 노드 payload와 같은 위치이므로 기존
   room 선택 로직이 그대로 동작해야 한다. `targetRoom`·`socketId` 같은 전송 지시는 들어오지 않으며, 들어오더라도
   무시한다(라우팅은 WS 서버의 모델이다).
3. **알 수 없는 type 처리**: 모르는 `payload.type`은 버리지 말고 그대로 전달하거나, 최소한 WARN 로그만 남기고
   연결을 끊지 않는다. 백엔드가 타입을 먼저 추가하고 FE가 나중에 따라오는 순서가 정상이다.
4. **권한 경계 유지**: 회의 이벤트에는 `userId`(초대자)가 들어 있지만 이는 "누가 시작했는지" 표시용이지
   수신자 필터가 아니다. 워크스페이스 room 참여자 전원에게 전달한다. 1:1 전달이 필요하다는 요구가 생기면
   백엔드 계약을 먼저 바꾼다.

## 하지 않는 것

- 회의 상태를 WS 서버가 판정하지 않는다. "최초 전이 1회"는 백엔드가 DB 상태로 보장한다.
- 누락 복구를 WS 서버가 하지 않는다. Pub/Sub은 구독자가 없으면 메시지를 버리므로, 새로고침·재접속 시 상태
  복구는 프런트엔드가 `GET /v1/aideep/api/meeting?workspaceId=...`를 호출해서 한다.
- 이벤트를 저장하거나 재생하지 않는다. 이력이 필요하면 백엔드 조회 API를 쓴다.

## 검증 시나리오

1. 권한 있는 사용자로 프런트엔드를 열고 `/workspace` namespace에서 `join_workspace` 성공을 확인한다.
2. 백엔드에서 회의 봇을 초대한다. `redis-cli SUBSCRIBE aideep.realtime.v1`로 `MEETING_BOT_REQUESTED`
   envelope가 나가는지 먼저 확인하고, 브라우저에서 `workspace_event` 수신을 확인한다.
3. 봇이 실제로 회의에 들어가 녹음이 시작되면 `MEETING_BOT_JOINED`가 1회만 오는지 확인한다. Recall이 같은
   상태 웹훅을 재시도해도 추가 이벤트가 없어야 한다(백엔드에서 거른다).
4. 회의 종료 후 `MEETING_BOT_LEFT`를 확인한다. `CALL_ENDED` 시점에는 아무 이벤트도 오지 않는 것이 정상이다.
5. 다른 워크스페이스에 접속한 클라이언트에는 전달되지 않는지 확인한다.
6. WS 서버를 내린 상태에서 상태 변화를 만든 뒤 다시 띄워, 그 이벤트가 **오지 않는 것**을 확인한다(의도된
   동작이다). 이어서 FE가 조회 API로 상태를 복구하는지 확인한다.

## 미결정 사항

- ~~현재 `aideep-ws`가 `payload.type`을 검사하는지 (위 1번)~~ → **해결**: 검사하지 않는다(투명 전달).
  대신 에코 억제 로직 때문에 초대자 제외 버그가 있었고, 이를 `ECHO_SUPPRESSED_TYPES` 로 좁혀 수정했다.
- `FAILED` 직후 `DONE`이 오는 Recall 특성상 `MEETING_BOT_FAILED` 다음에 `MEETING_BOT_LEFT`가 올 수 있다.
  FE에서 어색하면 억제 규칙이 필요한데, 그 판단은 백엔드 계약 쪽에서 한다(WS 서버는 순서를 바꾸지 않는다).
- 회의 이벤트 전용 room을 나눌 필요가 생기는지 (예: 회의 참석자만 수신). 현재 설계는 워크스페이스 room 전체
  브로드캐스트다.
