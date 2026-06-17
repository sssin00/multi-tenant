# outbox-relay-service

서비스 DB의 Outbox 이벤트를 읽어 EventBridge/SQS로 발행합니다. 감사 로그 저장 경로는 기본적으로 SQS를 사용하며, `audit-log-service`가 같은 queue를 polling해 append-only 감사 로그로 저장합니다.

## Local run

```bash
pnpm --filter outbox-relay-service dev
```

기본 포트는 `OUTBOX_PORT=3007`입니다.

현재 구현 범위는 NestJS 실행 shell, `/health`, `/ready`, source DB polling, lock/retry/failed 상태 전환, mock/EventBridge/SQS publisher, 내부 운영 조회 API입니다.

로컬에서 DB URL 없이 readiness를 통과시키려면 worker를 끕니다.

```bash
OUTBOX_WORKER_ENABLED=false pnpm --filter outbox-relay-service dev
```

## Environment

- `OUTBOX_PORT`: 서비스 포트. 기본값은 `3007`입니다.
- `OUTBOX_WORKER_ENABLED`: worker loop 실행 여부입니다.
- `OUTBOX_SOURCES`: polling할 source 목록입니다. 기본값은 `auth-iam,tenant`입니다.
- `OUTBOX_PUBLISHER_TYPE`: `mock`, `eventbridge`, `sqs` 중 하나입니다. 로컬은 `mock`, CDK 배포 기본값은 `sqs`입니다.
- `OUTBOX_EVENTBRIDGE_BUS_NAME`: EventBridge publisher 대상 bus 이름입니다. `OUTBOX_PUBLISHER_TYPE=eventbridge`일 때 필요합니다.
- `OUTBOX_SQS_QUEUE_URL`: SQS publisher 대상 queue URL override입니다. CDK 배포에서 비어 있으면 관리형 audit event queue URL이 주입됩니다.
- `OUTBOX_SQS_ENDPOINT`: LocalStack 등 로컬 SQS endpoint override입니다. AWS 환경에서는 비워 둡니다.
- `AUTH_IAM_OUTBOX_DATABASE_URL`, `TENANT_OUTBOX_DATABASE_URL`, `WMS_OUTBOX_DATABASE_URL`: source별 outbox DB URL secret입니다. 일반 application `DATABASE_URL`을 재사용하지 않습니다.
