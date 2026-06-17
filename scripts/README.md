# Scripts

개발, 배포, DB, AWS 보조 스크립트를 관리합니다.

## Local Verification

```bash
pnpm test:outbox:sqs:local
```

로컬 Docker compose의 PostgreSQL과 LocalStack을 사용해 `outbox-relay-service -> SQS -> audit-log-service` 감사 로그 저장 경로를 검증합니다.
스크립트는 LocalStack SQS queue를 만들고, audit-log-service consumer와 outbox-relay-service SQS publisher를 임시 포트에서 실행한 뒤 검증 event를 `auth_iam.outbox_events`에 삽입합니다.
성공 기준은 outbox row가 `published`로 전환되고 같은 `eventId`가 `audit_log.audit_logs`에 저장되는 것입니다.
