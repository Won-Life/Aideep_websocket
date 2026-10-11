# Datadog 모니터링

Docker Compose의 기존 `dd-agent`로 메트릭, 로그, APM을 수집한다. 서비스명 기본값은 `aideep-websocket`, 환경은 `prod`, 버전은 `IMAGE_TAG`다. 애플리케이션에 Datadog API 키를 설정할 필요가 없다.

## 배포 설정

- 운영 `.env`에서 `DD_TRACE_ENABLED=true`를 설정한다. Compose에서는 미설정 시 활성화되지만 `.env.example`을 복사하면 로컬용 `false`가 우선한다. Nest 개발 실행에서는 명시적 `true`일 때만 APM을 초기화한다.
- Agent에는 로그 수집(`DD_LOGS_ENABLED=true`), APM(`DD_APM_ENABLED=true`), Docker socket 및 컨테이너 로그 접근 권한이 필요하다. 앱의 로그 수집 라벨이 있으므로 전체 컨테이너 로그 수집 옵션은 필수가 아니다.
- 현재 Agent와 앱에 `/var/run/datadog` 디렉터리를 공유한다. Agent의 `/var/run/datadog/apm.socket`이 존재하고 앱 실행 사용자에게 쓰기 권한이 있어야 한다. Compose는 소켓 디렉터리가 없으면 새로 만들지 않고 실패한다. 다른 호스트 경로는 `DD_SOCKET_DIR`로 지정한다.
- APM 전송 주소는 `DD_TRACE_AGENT_URL`로 재정의한다. TCP를 사용한다면 Agent의 8126 포트를 앱에서 접근 가능하게 설정해야 한다. 현재 Agent는 해당 포트를 호스트에 공개하지 않는다. 소켓 마운트는 기본 Compose에 유지되므로 소켓 없이 TCP만 쓰는 환경에서는 마운트도 조정한다.
- 메트릭 주소 기본값은 Agent에서 접근 가능한 `http://host.docker.internal:3321/metrics`다. Linux 등 다른 환경에서는 `DD_METRICS_ENDPOINT`를 Agent에서 접근 가능한 호스트 주소로 변경한다. 외부 공개 포트를 새로 열 필요는 없다.

배포 전 `docker compose config --quiet`로 설정을 검증한다. 기존 CI가 이미지를 빌드하고 Compose로 배포하므로 변경된 코드와 라벨은 다음 배포에서 적용된다. Agent의 별도 설정 변경은 이 저장소에서 자동 실행하지 않는다.

## 수집 내용

- 메트릭: HTTP 요청 수·처리 시간, 인증된 활성 WS 연결 수, 프로세스 CPU·RSS, Node.js heap·event loop lag. 명시적 목록만 수집하며 histogram bucket 수집은 꺼서 메트릭 수를 제한한다.
- 로그: 운영 환경의 Winston JSON stdout 로그. 기존 바이너리 요약 및 고빈도 이벤트 로그 억제를 유지한다. `dd-trace`의 Winston log injection으로 활성 HTTP/WS span의 trace ID와 span ID를 연결한다. 연결·해제 등 이벤트 span 밖의 로그에는 trace ID가 없을 수 있다.
- APM: HTTP 및 지원하는 PostgreSQL·Redis 호출, Socket.IO 구독 이벤트별 `websocket.event` span. WS resource는 구독 이벤트명, namespace는 `/workspace`다. 비동기 작업 완료·예외·구독 취소 시 span을 종료하고 `{ok:false}` 응답도 오류로 표시한다. JWT, 이벤트 본문, 사용자 ID는 WS span tag로 넣지 않는다. 예외의 메시지·스택과 자동 DB span 정보는 라이브러리의 일반 APM 수집 대상이다.
- `/metrics`와 `/healthz`는 HTTP APM 추적에서 제외한다. 소켓의 전체 연결 시간을 하나의 span으로 기록하지 않는다.

## 배포 후 확인

```sh
docker exec dd-agent test -S /var/run/datadog/apm.socket
docker exec aideep-ws test -w /var/run/datadog/apm.socket
docker exec dd-agent agent configcheck
docker exec dd-agent agent check openmetrics
docker exec dd-agent agent status
```

`configcheck`에서 앱 라벨의 OpenMetrics instance가 발견되어야 하고, check에 수집 오류가 없어야 한다. 여러 OpenMetrics instance가 있다면 websocket endpoint 결과를 확인한다. `status`에서 로그 수집과 trace receiver의 상태를 확인한다. 기존 Prometheus와 함께 수집할 수 있다.

1. 기존 클라이언트에서 인증된 `/workspace` 연결 및 `join_workspace` 이벤트를 발생시킨다. 연결 성공 때 활성 연결 수가 증가하고 해제 때 감소하며 인증 실패 때 변하지 않아야 한다.
2. 실제 HTTP API를 호출하고 DB·Redis 작업이 있는 WS 이벤트를 실행한다. `/healthz` 호출만으로는 HTTP trace가 생기지 않는다.
3. Datadog Logs와 APM에서 `service:aideep-websocket env:prod`를 조회한다. WS resource별 처리 시간·오류 및 해당 요청의 하위 DB·Redis span을 확인한다. JSON 로그의 `dd.trace_id`를 통해 trace를 열 수 있어야 한다.
4. Metrics Explorer에서 `aideep.websocket.ws.connections.active`, `aideep.websocket.http.requests.count`, `aideep.websocket.http.request.duration.sum`, `aideep.websocket.http.request.duration.count`를 조회한다. OpenMetrics counter 이름의 `_total`은 설정에서 제외하며 Datadog에는 `.count`로 수집된다.

Datadog UI에서 실제 조회하는 단계는 변경된 이미지 배포 후 수행한다. Agent API 키·계정 접속 정보는 문서나 애플리케이션 로그에 남기지 않는다.

## 참고

- [Docker OpenMetrics 수집](https://docs.datadoghq.com/containers/docker/prometheus/)
- [Node.js 추적 초기화](https://docs.datadoghq.com/tracing/trace_collection/dd_libraries/nodejs/)
- [Winston 로그와 trace 연결](https://docs.datadoghq.com/tracing/other_telemetry/connect_logs_and_traces/nodejs/)
- [Prometheus와 Datadog 메트릭 매핑](https://docs.datadoghq.com/integrations/guide/prometheus-metrics/)
