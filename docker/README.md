# Docker

로컬 개발 환경, 배포용 compose 템플릿, 서비스별 Dockerfile을 관리합니다.

## 로컬 실행

Docker Compose 프로젝트 이름은 `multi-tenant-local`로 고정합니다. Docker Desktop이나 `docker compose ls`에서 로컬 개발 스택이 이 이름으로 표시됩니다.

현재 로컬 compose는 구현이 완료된 `auth-iam-service`, `tenant-service`, `audit-log-service`, `outbox-relay-service`, `admin-bff-service`, `user-bff-service`, `gateway-service`, `wms-service`, `web-admin`, `web-wms`와 공용 의존성인 PostgreSQL, Redis, LocalStack을 실행합니다. PostgreSQL 인스턴스는 공유하되 서비스별 database를 분리하며, 로컬에서는 `service-databases-init`이 `auth_iam`, `tenant`, `audit_log`, `wms` database를 idempotent하게 생성합니다. `auth-iam-db-push`, `tenant-service-db-push`, `audit-log-service-db-push`, `wms-service-db-push`는 PostgreSQL 준비 후 각 서비스 Prisma schema를 자기 database에 반영하고 종료되는 초기화 작업입니다. 이후 고정 id, camelCase permission code, tenant setting처럼 현재 API가 표현하지 못하는 기준값은 DB seed로 유지하고, tenant status와 module 활성화처럼 API로 가능한 항목은 `scripts/db/seed-local-api.mjs`가 서비스 API를 호출해 반영합니다.

로컬에서도 업무 API는 gateway만 통과합니다. `admin-bff-service`와 `user-bff-service`는 compose 내부 네트워크에만 노출하고 host port를 열지 않습니다. 브라우저와 Postman의 `/api/admin/**`, `/api/app/**` 요청은 `http://localhost:3000` gateway를 사용합니다.

로컬 기본값은 `outbox-relay-service`가 `mock` publisher를 사용하고 `audit-log-service`의 SQS consumer는 꺼둡니다. dev/staging/prod env 파일은 감사 이벤트 저장을 위해 `OUTBOX_PUBLISHER_TYPE=sqs`, `AUDIT_EVENT_CONSUMER_ENABLED=true`를 사용하며, queue URL은 CDK 관리형 audit event queue 또는 환경별 override 값으로 주입합니다.

환경 변수 파일 이름은 모든 프로젝트에서 `.env.local`, `.env.dev`, `.env.staging`, `.env.prod`만 사용합니다. `.env.example` 등 다른 env 파일 이름은 만들지 않습니다.

빌드하면서 실행:

```bash
docker compose -f docker/local/docker-compose.yml up --build
```

백그라운드 실행:

```bash
docker compose -f docker/local/docker-compose.yml up --build -d
```

Health check:

```bash
curl http://localhost:3000/health
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3005/health
curl http://localhost:3006/health
curl http://localhost:3007/health
curl http://localhost:3000/ready
curl http://localhost:3001/ready
curl http://localhost:3002/ready
curl http://localhost:3005/ready
curl http://localhost:3006/ready
curl http://localhost:3007/ready
```

Web:

```text
web-admin: http://localhost:5173
web-wms: http://localhost:5174
api gateway: http://localhost:3000
```

직접 호출 테스트 데이터:

```text
tenantId: 11111111-1111-4111-8111-111111111111
tenantCode: DEMO0001
email: admin@demo.local
password: Test1234!
role: tenant_admin
modules: auth, tenant, wms
```

seed만 다시 실행:

```bash
pnpm seed:local
```

`pnpm seed:local`은 DB seed job을 먼저 실행한 뒤, 실행 중인 tenant-service API에 status/module 기준값을 반영합니다.

서비스 DB를 모두 초기화하고 schema와 seed를 다시 넣기:

```bash
pnpm db:reset:local
```

`pnpm db:reset:local`은 database 재생성, Prisma schema push, DB seed, API 서비스 재기동, API seed를 순서대로 실행합니다.

Outbox Relay에서 LocalStack SQS를 거쳐 Audit Log까지 저장되는지 확인:

```bash
pnpm test:outbox:sqs:local
```

이 검증은 PostgreSQL과 LocalStack이 실행 중이어야 합니다. 스크립트는 LocalStack SQS queue를 만들고, `audit-log-service` consumer와 `outbox-relay-service` SQS publisher를 임시 포트에서 실행한 뒤 검증 이벤트가 `auth_iam.outbox_events`에서 `published`로 바뀌고 `audit_log.audit_logs`에 같은 `eventId`로 저장되는지 확인합니다.

WMS 기준정보/재고/입고/출고와 Outbox Relay, LocalStack SQS, Audit Log 연계를 확인:

```bash
pnpm test:wms:local
```

이 검증은 `wms-service`, `auth-iam-service`, `tenant-service`, PostgreSQL, LocalStack이 실행 중이어야 합니다. 스크립트는 WMS 내부 API를 `admin-bff-service` caller로 호출하고, WMS outbox event가 SQS를 거쳐 `audit_log.audit_logs`에 저장되는지 5개 시나리오로 확인합니다.

gateway를 통한 로그인 확인:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -H 'X-Tenant-Id: 11111111-1111-4111-8111-111111111111' \
  -d '{"tenantId":"11111111-1111-4111-8111-111111111111","email":"admin@demo.local","password":"Test1234!"}'
```

로그 확인:

```bash
docker compose -f docker/local/docker-compose.yml logs -f gateway-service auth-iam-service tenant-service audit-log-service outbox-relay-service admin-bff-service wms-service
```

중지:

```bash
docker compose -f docker/local/docker-compose.yml down
```

이미지만 빌드:

```bash
docker compose -f docker/local/docker-compose.yml build
```

Compose 설정 확인:

```bash
docker compose -f docker/local/docker-compose.yml config
```

NestJS 서비스 이미지는 `docker/services/Dockerfile.nest`를 공통으로 사용하고, `APP_NAME` build arg로 실행할 앱을 지정합니다. 런타임 이미지는 `pnpm deploy --prod` 결과만 복사하고 `node` 사용자로 실행합니다.

로컬 PostgreSQL database:

```text
auth-iam-service -> auth_iam
tenant-service -> tenant
audit-log-service -> audit_log
wms-service -> wms
```

TablePlus 등 host DB client에서 Docker PostgreSQL에 접속할 때는 Mac 로컬 PostgreSQL과 포트가 겹치지 않도록 host port `55432`를 사용합니다.

```text
Host: 127.0.0.1
Port: 55432
User: postgres
Password: postgres
Database: auth_iam, tenant, audit_log 또는 wms
```

테넌트별 저장 전략의 Shared DB + `tenantId` 원칙은 각 서비스 database 안에서 tenant-owned data를 구분하는 기준입니다. 서비스 간 database를 공유한다는 의미가 아닙니다.

TablePlus 등 host Redis client에서 Docker Redis에 접속할 때는 Mac 로컬 Redis와 포트가 겹치지 않도록 host port `6380`을 사용합니다. 컨테이너 내부 서비스들은 Docker network 안에서 계속 `redis://redis:6379`를 사용합니다.

```text
Host: 127.0.0.1
Port: 6380
User: 비움 또는 default
Password: 비움
Database: 0
SSL: off
```

## 배포용 실행

배포용 compose는 이미 빌드/푸시된 `audit-log-service`, `outbox-relay-service`, `auth-iam-service`, `tenant-service`, `admin-bff-service`, `gateway-service` 이미지를 실행합니다. 환경별 값은 서비스별 `docker/env/{service}/.env.local`, `.env.dev`, `.env.staging`, `.env.prod` 중 하나를 사용합니다. 운영 secret은 저장소에 커밋하지 않습니다.

배포 env에서 감사 이벤트 경로는 `outbox-relay-service`가 SQS message body에 event envelope를 보존해 발행하고, `audit-log-service`가 `AUDIT_EVENT_QUEUE_URL`을 polling해 `audit_logs`에 저장하는 방식입니다. 저장 성공 메시지만 삭제하며, 실패 메시지는 SQS retry와 DLQ 정책으로 처리합니다.

배포 compose의 환경 선택은 `COMPOSE_ENV`로 합니다. 예: `COMPOSE_ENV=dev`, `COMPOSE_ENV=staging`, `COMPOSE_ENV=prod`. 값을 주지 않으면 `local`을 사용합니다.

설정 확인:

```bash
COMPOSE_ENV=dev docker compose -f docker/deploy/docker-compose.yml config
```

백그라운드 실행:

```bash
COMPOSE_ENV=dev docker compose -f docker/deploy/docker-compose.yml up -d
```

Health check:

```bash
curl http://localhost:3000/health
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3006/health
curl http://localhost:3007/health
```

로그 확인:

```bash
COMPOSE_ENV=dev docker compose -f docker/deploy/docker-compose.yml logs -f gateway-service auth-iam-service tenant-service audit-log-service outbox-relay-service admin-bff-service
```

중지:

```bash
COMPOSE_ENV=dev docker compose -f docker/deploy/docker-compose.yml down
```

이미지 교체 후 재배포:

```bash
COMPOSE_ENV=dev docker compose -f docker/deploy/docker-compose.yml pull
COMPOSE_ENV=dev docker compose -f docker/deploy/docker-compose.yml up -d
```

AWS ECS 배포는 compose가 아니라 `infra/cdk`에서 관리합니다. `docker/deploy/docker-compose.yml`은 단독 서버나 VM에서 컨테이너를 실행하기 위한 템플릿입니다.
로컬 compose와 동시에 검증할 때는 `COMPOSE_ENV`별 container name과 host port 충돌 여부를 먼저 확인합니다.
