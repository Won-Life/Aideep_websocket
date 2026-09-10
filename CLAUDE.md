# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`aideep-websocket-server` — Aideep 실시간 서버 (NestJS 11 + Socket.IO + Yjs CRDT).
`Aideep_backend` 에서 WS/Yjs 계층만 분리해 나온 별도 프로젝트입니다.

## Commands

```bash
pnpm install              # 의존성 설치 (.npmrc 가 frozen-lockfile=true 이므로 package.json 수정 시 --no-frozen-lockfile)

pnpm run start:dev        # watch 모드 (개발 권장)
pnpm run start:debug      # Node inspector

pnpm run build            # dist/ 로 컴파일 (nest build)
pnpm run start:prod       # node dist/src/main

pnpm run test             # 전체 유닛 테스트
pnpm run test -- test/ws  # 특정 도메인만
pnpm run test:cov         # 커버리지

pnpm run format           # Prettier
pnpm run lint             # ⚠️ 현재 실패 — 아래 "알려진 이슈" 참고

npx prisma generate       # src/generated/prisma 재생성 (migrate 는 여기서 실행 금지)
```

## 파일 구조

큰 축은 `src/domain` 과 `src/global` 두 개입니다. 업무 도메인은 `domain/`, 여러 도메인이 공통으로 쓰는 계층은 `global/` 에 둡니다. 테스트는 `src/` 와 같은 레벨의 `test/` 아래 도메인별 폴더로 모읍니다.

```
src/
  main.ts                      # 부트스트랩 (전역 파이프/필터/인터셉터, prefix 'aideep/api')
  app.module.ts                # 루트 모듈
  health.controller.ts         # GET /healthz
  generated/prisma/**          # prisma generate 산출물 — 직접 수정 금지, gitignore 대상

  domain/
    node-content/
      node-content.module.ts
      controller/node-content.controller.ts
      service/node-content.service.ts
      repository/node-content.repository.ts
      dto/nodeContentOperation.dto.ts
    ws/
      ws.module.ts
      controller/ws.gateway.ts       # Socket.IO 게이트웨이 (namespace '/workspace')
      service/presence.service.ts
      type/ws.event.ts               # workspace_event 페이로드 타입
    event-bus/
      event-bus.module.ts
      service/event-bus.subscriber.ts
      type/event-bus.contract.ts  # API 서버와의 Redis pub/sub 계약
    file-attachment/
      file-attachment.module.ts
      service/file-attachment.service.ts
      repository/file-attachment.repository.ts
    membership/
      repository/membership.repository.ts

  global/
    auth/       realtime-auth.module.ts, guards/jwt.guard.ts, strategy/jwt.strategy.ts
    common/
      context/   request.context.ts, request-context.middleware.ts (AsyncLocalStorage)
      error/     basic-error.ts, db-error-handler.ts, http-exception.filter.ts, index.ts
      logging/   winston 설정, logging.interceptor.ts, log-format.ts
      metrics/   prom-client 기반 HTTP/WS 메트릭, metrics.module.ts
      response/  ResponseInterceptor + 응답 DTO/데코레이터
    prisma/     prisma.module.ts, prisma.service.ts, transaction.storage.ts, transactional.decorator.ts
    redis/      redis.module.ts, redis.service.ts, redis.keys.ts, embed-queue.service.ts
    upload/     s3.service.ts
    yjs/        yjs.module.ts, yjs-crdt.service.ts, yjs-doc-manager.ts,
                yjs-ws-awareness.service.ts, markdown-yjs.ts, yjs.constants.ts

test/
  mocks/uuid.ts                # jest moduleNameMapper 로 uuid 를 대체
  node-content/  ws/  event-bus/  yjs/    # 도메인명 폴더 아래 *.spec.ts
```

### 폴더 규칙

- **`domain/<도메인>/`** — `*.module.ts` 는 도메인 루트에, 나머지는 역할별 폴더로:
  `controller/` (HTTP 컨트롤러 + WS 게이트웨이) / `service/` / `repository/` / `dto/` / `type/`
  해당 역할의 파일이 없으면 폴더도 만들지 않습니다 (예: `membership` 은 `repository/` 만).
- **`global/<계층>/`** — 공통 계층은 역할별 3분할을 적용하지 않고 평평하게 둡니다.
- **테스트** — 소스 옆이 아니라 `test/<도메인>/` 에 둡니다. jest 는 `roots: ["<rootDir>/test"]` 라 `src/` 안의 `*.spec.ts` 는 실행되지 않습니다.
- **새 도메인 추가 시** — `src/domain/<이름>/` 생성 → `<이름>.module.ts` + 필요한 역할 폴더 → `app.module.ts` 에 등록 → 테스트는 `test/<이름>/`.

## 임포트 경로 규칙

`tsconfig.json` 의 `paths` 로 별칭이 정의돼 있습니다.

| 별칭           | 대상              |
| -------------- | ----------------- |
| `@domain/*`    | `src/domain/*`    |
| `@global/*`    | `src/global/*`    |
| `@generated/*` | `src/generated/*` |

- **같은 모듈 내부**(같은 도메인 폴더 안, 또는 `global/common` 안)는 상대경로:
  `./node-content.service`, `../repository/node-content.repository`
- **폴더 경계를 넘으면 반드시 별칭**:
  `@global/redis/redis.service`, `@domain/ws/controller/ws.gateway`, `@generated/prisma/client`
- **`test/` 하위는 전부 별칭** (상대경로로 `src/` 를 참조하지 않습니다)

`nest build` 가 emit 시 별칭을 상대경로로 치환하므로 런타임에 별도 로더는 필요 없습니다. jest 는 `package.json` 의 `moduleNameMapper` 로 같은 별칭을 해석합니다. **별칭을 추가하면 `tsconfig.json` 과 `package.json` 의 `moduleNameMapper` 양쪽을 함께 고쳐야 합니다.**

## 아키텍처

- **REST**: prefix `aideep/api` (`/healthz`, `/metrics` 는 제외). Swagger 플러그인이 `nest-cli.json` 에 설정돼 있습니다.
- **WebSocket**: Socket.IO, namespace `/workspace`. handshake `auth.token` 의 JWT 로 인증.
  - 워크스페이스 레벨: `join_workspace`, `node_position_live`, `cursor_move` / 서버→클라 `workspace_event`, `presence_state`, `cursor_leave`
  - 문서(노드) 레벨 Yjs: `yjs:join`, `yjs:sync`, `yjs:awareness`, `yjs:leave` (이벤트명 상수는 `@global/yjs/yjs.constants`)
- **event-bus**: API 서버(추후 Spring)가 Redis 채널로 발행한 이벤트를 구독해 WS 로 팬아웃합니다. `type/event-bus.contract.ts` 는 **양쪽이 공유하는 계약 사본**이므로 변경 시 `Aideep_backend` 쪽과 함께 갱신해야 합니다.
- **응답/예외**: 모든 응답은 `ResponseInterceptor` 봉투로 감싸지고, 예외는 `AllExceptionsFilter` 가 처리합니다. raw `HttpException` 대신 `@global/common/error` 의 도메인 예외를 쓰세요.
- **Prisma**: `prisma/schema.prisma` 는 `Aideep_backend` 스키마의 **축소 사본**입니다. 이 프로젝트에서는 `prisma generate` 만 실행하고 **`prisma migrate` 는 절대 실행하지 않습니다** (migrate 소유권은 `Aideep_backend`).

## Environment Variables

`.env` 필요 (`.env.example` 참고):

```
DATABASE_URL=
PORT=3321
REDIS_HOST=  REDIS_PORT=  REDIS_USERNAME=  REDIS_PASSWORD=
JWT_SECRET=
AWS_REGION=  AWS_S3_BUCKET=
REALTIME_ADMIN_UI=false     # socket.io admin-ui (인증 없음) 토글
```

## 알려진 이슈

- **`pnpm lint` 는 현재 실패합니다.** `eslint.config.mjs` 에서 tseslint 플러그인 등록부가 통째로 주석 처리돼 있는데 `@typescript-eslint/no-unused-vars` 규칙은 살아 있어 "plugin is not defined" 에러가 납니다. 코드 문제가 아니라 설정 문제이며, 별도 수정이 필요합니다.
- `.npmrc` 가 `frozen-lockfile=true` 라 `package.json` 의존성을 바꾼 뒤 `pnpm install` 은 실패합니다. `--no-frozen-lockfile` 로 lockfile 을 갱신하세요.
