# audit-log-service

사용자와 관리자의 중요한 업무 행위를 append-only 감사 로그로 저장하고 조회합니다.

외부 조회 요청은 `gateway-service` -> `admin-bff-service` -> `audit-log-service` 순서로 처리합니다. 감사 로그 저장은 각 서비스의 outbox 이벤트를 audit-log-service consumer가 소비하는 방식으로 처리하며, `eventId` 기준으로 중복 저장을 방지합니다. 자체 outbox가 없는 `user-bff-service`의 app shell 감사 이벤트는 EventBridge 직접 발행을 우선 사용하고, 내부 `POST /api/internal/audit/logs`는 local/호환 fallback으로 유지합니다.

AWS dev/staging/prod에서는 `outbox-relay-service`가 SQS로 발행한 event envelope를 `audit-log-service`의 SQS worker가 polling해 저장합니다. 로컬 기본값은 SQS consumer disabled이며, 필요할 때 `AUDIT_EVENT_CONSUMER_ENABLED=true`와 queue URL을 설정합니다.

## Scripts

- `pnpm --filter audit-log-service dev`: NestJS 개발 서버를 실행합니다.
- `pnpm --filter audit-log-service typecheck`: TypeScript 타입 검사를 실행합니다.
- `pnpm --filter audit-log-service build`: `dist` 빌드를 생성합니다.
- `pnpm --filter audit-log-service prisma:migrate:deploy`: 운영/배포 DB에 Prisma migration을 적용합니다.

## Environment

- `AUDIT_PORT`: 서비스 포트. 기본값은 `3006`입니다.
- `AUDIT_INTERNAL_AUTH_SECRET`: 내부 조회 API 인증에 사용할 32자 이상 secret입니다.
- `AUDIT_INTERNAL_AUTH_ALLOWED_SERVICES`: 감사 로그 내부 API를 호출할 수 있는 서비스 목록입니다. 기본값은 `admin-bff-service,user-bff-service`입니다.
- `AUDIT_EVENT_CONSUMER_ENABLED`: SQS polling consumer 실행 여부입니다. 로컬 기본값은 `false`, CDK 배포 기본값은 `true`입니다.
- `AUDIT_EVENT_QUEUE_URL`: 소비할 SQS queue URL입니다. CDK 배포에서 비어 있으면 관리형 audit event queue URL이 주입됩니다.
- `AUDIT_EVENT_SQS_ENDPOINT`: LocalStack 등 로컬 SQS endpoint override입니다.
- `AUDIT_EVENT_POLL_INTERVAL_MS`: poll cycle 간 대기 시간입니다. 기본값은 `5000`입니다.
- `AUDIT_EVENT_WAIT_TIME_SECONDS`: SQS long polling 대기 시간입니다. 기본값은 `10`입니다.
- `AUDIT_EVENT_VISIBILITY_TIMEOUT_SECONDS`: 메시지 처리 중 visibility timeout입니다. 기본값은 `60`입니다.
- `AUDIT_EVENT_BATCH_SIZE`: 한 번에 받을 메시지 수입니다. SQS 제한에 맞춰 `1`-`10` 범위를 사용합니다.

## Production database

운영 배포에서는 `DATABASE_URL`을 plain environment로 주입하지 않고 AWS Secrets Manager secret으로 관리합니다. GitHub Environment secret `AUDIT_DATABASE_URL_SECRET_ARN`에는 해당 Secrets Manager ARN을 넣습니다.

권장 secret 이름은 `multi-tenant-{env}-audit-log-service-database-url`입니다. SecretString은 PostgreSQL URL 문자열이거나 `{ "DATABASE_URL": "postgresql://..." }` JSON 형식을 사용할 수 있습니다.

운영 schema 변경은 `prisma db push`가 아니라 `prisma migrate deploy`만 사용합니다. `deploy-audit-log-service` workflow의 `runAuditPrismaMigration` 입력을 `true`로 실행하면 `AUDIT_DATABASE_URL_SECRET_ARN`에서 URL을 읽어 migration을 적용합니다.
