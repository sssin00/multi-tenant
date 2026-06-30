# Multi-Tenant Smart Factory

AWS ECS Fargate 기반 멀티테넌트 스마트 팩토리 플랫폼입니다.

첫 메인 도메인은 WMS이며, 이후 MES/QMS/FMS/EMS 같은 제조 도메인을 같은 구조로 확장할 수 있도록 Gateway, BFF, Domain Service, Outbox, Audit Log, CDK 인프라를 먼저 구축하는 것을 목표로 합니다.

## 현재 상태

현재 저장소는 WMS first 전략에 맞춰 백엔드 플랫폼, 관리자/WMS 화면, 로컬 검증 환경, AWS 배포 기반을 포함합니다.

| 영역 | 상태 |
| --- | --- |
| Backend | NestJS 기반 8개 주요 backend service 구현 |
| Frontend | `web-admin`, `web-wms` React + Vite 1차 구현 |
| Local | Docker Compose로 PostgreSQL, Redis, LocalStack, backend, web 실행 |
| AWS | CDK로 ECS Fargate, ECR, ALB, VPC, Cloud Map, Redis, SQS/DLQ, CloudWatch 구성 가능 |
| Deployment | GitHub Actions 자동 push 배포는 비활성화, 수동 `workflow_dispatch` 배포만 사용 |
| Docs | 설계/API/개발과정/테스트 로그는 `docs/index.html`에서 확인 |

비용 관리를 위해 AWS 서비스는 항상 켜두는 구조가 아닙니다. 필요할 때 CDK/GitHub Actions로 배포하고, 검증 후 desired count를 낮추거나 스택을 정리하는 방식으로 운영합니다.

## 아키텍처 요약

외부 업무 API는 `gateway-service` 하나로 들어오고, 화면별 API 조합은 BFF가 담당합니다. 도메인 서비스는 자기 업무 규칙과 데이터만 소유합니다.

```text
web-admin / web-wms
  -> gateway-service
    -> auth-iam-service
    -> admin-bff-service
      -> tenant-service / auth-iam-service / audit-log-service
    -> user-bff-service
      -> tenant-service / auth-iam-service / wms-service / audit-log-service

wms-service / tenant-service / auth-iam-service
  -> outbox_events
  -> outbox-relay-service
  -> SQS / EventBridge / mock publisher
  -> audit-log-service
```

### Gateway와 BFF를 나눈 이유

- `gateway-service`: 외부 진입점, JWT 검증, tenant context, requestId, rate limit, proxy routing 담당
- `admin-bff-service`: 관리자 화면에 필요한 tenant/user/rbac/audit API 조합 담당
- `user-bff-service`: 사용자/WMS 화면에 필요한 app shell, navigation, WMS 조회 API 조합 담당
- `wms-service`, `tenant-service`, `auth-iam-service`: 실제 도메인 규칙과 데이터 소유

gateway를 얇게 유지하면 보안 경계와 라우팅 책임이 명확해지고, 화면 요구사항은 BFF에서 흡수하며, WMS 같은 도메인 서비스는 업무 규칙에 집중할 수 있습니다.

## 서비스 구성

| 경로 | 역할 |
| --- | --- |
| `apps/gateway-service` | 외부 API 단일 진입점, JWT 검증, tenant context, rate limit, proxy |
| `apps/auth-iam-service` | 로그인, JWT/refresh token, 사용자, 역할, 권한, permission check |
| `apps/tenant-service` | tenant, module, domain, status/readiness 관리 |
| `apps/admin-bff-service` | 관리자 화면용 tenant/user/rbac/audit API 조합 |
| `apps/user-bff-service` | 사용자 app shell/navigation, WMS 화면 API 조합 |
| `apps/wms-service` | 창고/로케이션/품목, 재고, 스냅샷, 입고, 출고, 포장, 출하 |
| `apps/audit-log-service` | append-only 감사 로그 저장 및 조회 |
| `apps/outbox-relay-service` | outbox polling, event/SQS 발행, retry/failure 처리 |
| `apps/web-admin` | 관리자 React + Vite 앱 |
| `apps/web-wms` | WMS 운영자 React + Vite 앱 |

## 폴더 구조

```text
apps/          실행 가능한 backend service와 frontend app
packages/      공통 TypeScript 패키지
infra/cdk/     AWS CDK TypeScript 인프라 코드
docker/        로컬/배포용 Docker Compose, Dockerfile, env 파일
docs/          설계, API, 개발 과정, 테스트 로그 문서
postman/       로컬 API 검증용 Postman collection
scripts/       DB seed/reset, 로컬 검증, 보조 스크립트
tools/         workspace 공통 도구
```

## 요구사항

- Node.js
- pnpm `9.15.0`
- Docker Desktop
- AWS CLI, CDK, GitHub CLI는 AWS 배포 또는 저장소 운영 시 필요

설치:

```bash
pnpm install
```

## 로컬 실행

로컬은 Docker Compose 기준으로 실행하는 것을 기본으로 합니다.

```bash
docker compose -f docker/local/docker-compose.yml up --build
```

백그라운드 실행:

```bash
docker compose -f docker/local/docker-compose.yml up --build -d
```

중지:

```bash
docker compose -f docker/local/docker-compose.yml down
```

### 로컬 접속 주소

| 대상 | 주소 |
| --- | --- |
| gateway API | `http://localhost:3000` |
| web-admin | `http://localhost:5173` |
| web-wms | `http://localhost:5174` |
| PostgreSQL host 접속 | `127.0.0.1:55432` |
| Redis host 접속 | `127.0.0.1:6380` |

로컬에서도 업무 API는 gateway만 통과합니다. `admin-bff-service`와 `user-bff-service`는 Docker 내부 네트워크에서만 접근하고 host port를 열지 않습니다.

### 로컬 기본 테스트 계정

```text
tenantId: 11111111-1111-4111-8111-111111111111
tenantCode: DEMO0001
email: admin@demo.local
password: Test1234!
role: tenant_admin
modules: auth, tenant, wms
```

gateway를 통한 로그인 예시:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -H 'X-Tenant-Id: 11111111-1111-4111-8111-111111111111' \
  -d '{"tenantId":"11111111-1111-4111-8111-111111111111","email":"admin@demo.local","password":"Test1234!"}'
```

## DB 초기화와 Seed

서비스 DB를 모두 초기화하고 schema와 seed를 다시 넣으려면:

```bash
pnpm db:reset:local
```

seed만 다시 실행하려면:

```bash
pnpm seed:local
```

로컬 PostgreSQL은 하나의 인스턴스를 사용하지만 서비스별 database를 분리합니다.

```text
auth-iam-service -> auth_iam
tenant-service   -> tenant
audit-log-service -> audit_log
wms-service      -> wms
```

## 개발 명령어

```bash
pnpm dev          # workspace dev 병렬 실행
pnpm build        # 전체 build
pnpm typecheck    # 전체 typecheck
pnpm test         # 현재 설정된 test script 실행
pnpm lint         # 현재 설정된 lint script 실행
```

개별 실행 예시:

```bash
pnpm --filter gateway-service dev
pnpm --filter auth-iam-service dev
pnpm --filter tenant-service dev
pnpm --filter admin-bff-service dev
pnpm --filter user-bff-service dev
pnpm --filter wms-service dev
pnpm --filter web-admin dev
pnpm --filter web-wms dev
```

## 로컬 검증

전체 타입 검증:

```bash
pnpm -w typecheck
```

Outbox Relay에서 LocalStack SQS를 거쳐 Audit Log까지 저장되는지 확인:

```bash
pnpm test:outbox:sqs:local
```

WMS 기준정보/재고/입고/출고와 Outbox/Audit 연계 확인:

```bash
pnpm test:wms:local
```

전체 시스템 시나리오 확인:

```bash
pnpm test:system:local
```

테스트 기준과 로그는 아래 문서에서 확인합니다.

```text
docs/test-scenarios/system-test-scenarios.html
docs/test-scenarios/performance-test-criteria.html
docs/test-logs/
```

## AWS 배포 상태

현재 AWS 배포는 수동 실행 기준입니다.

- CDK는 8개 backend service 배포 기반을 관리합니다.
- frontend 앱의 AWS 호스팅은 아직 CDK 주요 배포 범위가 아닙니다. 로컬 Docker와 앱 build 기준이 준비되어 있습니다.
- RDS/Aurora, Route53 record, 비감사 EventBridge bus, 일반 S3 bucket은 아직 CDK 스택에 포함되어 있지 않습니다.
- DB 접속 정보와 runtime secret은 Secrets Manager/SSM 기반 주입을 전제로 합니다.
- GitHub Actions의 자동 push 배포는 비활성화되어 있고, GitHub Actions 화면에서 수동 실행합니다.

CDK가 관리하는 주요 리소스:

```text
ECR repository per service
VPC public/private subnet
ECS cluster
ECS Fargate task/service
ALB listener/target group
Cloud Map private DNS namespace
ElastiCache Redis
SQS audit event queue / DLQ
CloudWatch log group
Security group
```

## AWS CDK 배포 방법

CDK 명령:

```bash
pnpm infra:synth
pnpm infra:diff
pnpm infra:deploy
```

첫 배포는 ECR repository와 기본 인프라를 만들기 위해 desired count를 `0`으로 둡니다. 이미지를 ECR에 push하고 Secrets Manager secret ARN을 준비한 뒤 desired count를 올려 재배포합니다.

개발 계정의 Elastic IP 한도 때문에 NAT Gateway 생성이 막히는 경우 dev 환경에서만 임시로 아래 context를 사용할 수 있습니다.

```bash
pnpm --filter @multi-tenant/infra-cdk exec cdk deploy \
  -c gatewayDesiredCount=0 \
  -c authDesiredCount=0 \
  -c tenantDesiredCount=0 \
  -c adminBffDesiredCount=0 \
  -c userBffDesiredCount=0 \
  -c wmsDesiredCount=0 \
  -c auditDesiredCount=0 \
  -c outboxDesiredCount=0 \
  -c gatewayUseNatGateway=false
```

실행 배포 시에는 각 서비스 image tag, desired count, secret ARN을 명시해야 합니다. 자세한 context와 secret 목록은 `infra/README.md`를 기준으로 합니다.

## GitHub Actions 배포 방법

배포 workflow는 모두 수동 실행입니다.

```text
.github/workflows/deploy-gateway-service.yml
.github/workflows/deploy-auth-iam-service.yml
.github/workflows/deploy-tenant-service.yml
.github/workflows/deploy-admin-bff-service.yml
.github/workflows/deploy-user-bff-service.yml
.github/workflows/deploy-wms-service.yml
.github/workflows/deploy-audit-log-service.yml
.github/workflows/deploy-outbox-relay-service.yml
```

브랜치와 환경 매핑:

| Branch | GitHub Environment | APP_ENV / CDK envName |
| --- | --- | --- |
| `dev` | `dev` | `dev` |
| `staging` | `staging` | `staging` |
| `main` | `prod` | `prod` |

주의사항:

- 모든 workflow는 같은 CDK stack을 갱신합니다.
- 대상 서비스가 아닌 서비스도 desired count와 image tag를 명시해야 합니다.
- desired count가 0보다 큰 서비스는 필요한 runtime secret ARN도 함께 설정해야 합니다.
- image tag는 보통 `{env}-{gitSha12}` 형식을 사용합니다.
- 운영 secret 값은 저장소에 커밋하지 않습니다.

## API와 Postman

API 문서는 `docs/apis/` 아래 HTML로 관리합니다.

```text
docs/apis/index.html
docs/apis/gateway-service/
docs/apis/admin-bff-service/
docs/apis/user-bff-service/
docs/apis/auth-iam-service/
docs/apis/tenant-service/
docs/apis/wms-service/
docs/apis/audit-log-service/
docs/apis/outbox-relay-service/
```

Postman collection:

```text
postman/multi-tenant-local.postman_collection.json
```

API를 추가하거나 변경하면 관련 API HTML 문서, 서비스 개발 문서, Postman collection을 함께 갱신합니다.

## 문서

문서 시작점:

```text
docs/index.html
```

주요 문서:

```text
docs/design/project-rules.html
docs/design/aws-ecs-tech-stack.html
docs/design/msa-wms-roadmap.html
docs/design/smart-factory-aws-ecs.drawio
docs/development/service-feature-definitions.html
docs/development/services/
docs/infra/
docs/test-scenarios/
docs/test-logs/
```

커리어용 단일 HTML 문서:

```text
docs/career/backend-developer-resume.html
docs/career/backend-developer-portfolio.html
```

## 개발 규칙 요약

- 폴더와 파일 이름은 `kebab-case`를 사용합니다.
- TypeScript 클래스와 타입 이름은 `PascalCase`를 사용합니다.
- 함수와 변수 이름은 `camelCase`를 사용합니다.
- 상수와 환경 변수 이름은 `UPPER_SNAKE_CASE`를 사용합니다.
- API 주소는 `/api/{화면영역}/{업무영역}/{리소스}` 구조를 따릅니다.
- 이벤트 이름은 `{업무영역}.{리소스}.{완료된동작}` 구조를 따릅니다.
- Gateway는 업무 규칙이나 DB 접근을 직접 처리하지 않습니다.
- 외부에서 들어오는 관리자/사용자/업무 API는 Gateway를 통과한 뒤 BFF로 전달됩니다.
- 각 업무 서비스는 다른 서비스의 DB에 직접 접근하지 않고 API 또는 이벤트로 연계합니다.
- 테넌트가 필요한 요청, 로그, 이벤트, 데이터 접근에는 `tenantId`와 `requestId`를 포함합니다.
- API 응답 형식은 `success`, `requestId`, `timestamp`, `data` 또는 `error`를 사용합니다.

자세한 규칙은 `docs/design/project-rules.html`을 기준으로 합니다.
