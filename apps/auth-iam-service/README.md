# auth-iam-service

로그인, JWT, 사용자, 역할, 권한, 조직/창고 범위 접근 제어를 담당합니다.

API 상세 계약은 `docs/apis/auth-iam-service/index.html`에 정리합니다. 구현 진행 기록과 검증 기준은 `docs/development/services/auth-iam-service.html`을 함께 갱신합니다.

## 로컬 실행

```bash
pnpm --filter auth-iam-service dev
```

기본 포트는 `AUTH_PORT`로 설정하며, 기본값은 `3000`입니다. gateway-service와 함께 로컬에서 실행할 때는 포트 충돌을 피하기 위해 `AUTH_PORT=3001`처럼 별도 포트를 사용합니다.

## 검증

```bash
pnpm --filter auth-iam-service prisma:validate
pnpm --filter auth-iam-service prisma:generate
pnpm --filter auth-iam-service prisma:push
pnpm --filter auth-iam-service typecheck
pnpm --filter auth-iam-service build
```

Health check:

```bash
curl http://localhost:3001/health
curl http://localhost:3001/ready
```

Login:

```bash
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -H 'X-Request-Id: req-login-local' \
  -H 'X-Tenant-Id: 11111111-1111-4111-8111-111111111111' \
  -d '{"email":"worker@example.com","password":"user-password"}'
```

로그인 성공 응답은 `accessToken`, `expiresIn`, `refreshToken`, `refreshExpiresIn`, `tokenType`을 포함합니다. Access token JWT에는 `sub`, `tenantId`, `type`, `iat`, `exp`, `iss`, `aud`만 포함하고, refresh token은 DB에 hash로만 저장합니다.

Refresh token rotation:

```bash
curl -X POST http://localhost:3001/api/v1/auth/token/refresh \
  -H 'Content-Type: application/json' \
  -H 'X-Tenant-Id: 11111111-1111-4111-8111-111111111111' \
  -d '{"refreshToken":"opaque-refresh-token"}'
```

Logout/revoke:

```bash
curl -X POST http://localhost:3001/api/v1/auth/logout \
  -H 'Content-Type: application/json' \
  -H 'X-Tenant-Id: 11111111-1111-4111-8111-111111111111' \
  -d '{"refreshToken":"opaque-refresh-token"}'
```

Refresh 성공 시 기존 refresh token은 `revokedAt`과 `replacedBy`로 폐기되고 새 refresh token이 발급됩니다. 이미 폐기된 refresh token 재사용은 `401 AUTH_INVALID_TOKEN`으로 실패합니다.

Me:

```bash
curl http://localhost:3001/api/v1/auth/me \
  -H 'X-Request-Id: req-me-local' \
  -H 'X-Tenant-Id: 11111111-1111-4111-8111-111111111111' \
  -H 'X-User-Id: user-uuid'
```

`GET /api/v1/auth/me`는 gateway가 검증한 access token에서 전달한 사용자 context를 기준으로 현재 사용자, role, permission 요약을 반환합니다. JWT에는 role/permission을 넣지 않습니다.

User CRUD:

```bash
curl -X POST http://localhost:3001/api/v1/auth/users \
  -H 'Content-Type: application/json' \
  -H 'X-Tenant-Id: 11111111-1111-4111-8111-111111111111' \
  -d '{"email":"worker@example.com","displayName":"Worker","password":"user-password"}'

curl 'http://localhost:3001/api/v1/auth/users?page=1&size=20' \
  -H 'X-Tenant-Id: 11111111-1111-4111-8111-111111111111'

curl -X PATCH http://localhost:3001/api/v1/auth/users/{userId}/status \
  -H 'Content-Type: application/json' \
  -H 'X-Tenant-Id: 11111111-1111-4111-8111-111111111111' \
  -d '{"status":"locked"}'
```

모든 사용자 API는 `X-Tenant-Id` 기준으로 DB 접근을 제한합니다. 사용자 응답에는 `passwordHash`를 포함하지 않고, `inactive` 또는 `locked` 상태 전환 시 active refresh token을 revoke합니다. `DELETE /api/v1/auth/users/{userId}`는 hard delete가 아니라 `inactive` 전환입니다.

RBAC:

```bash
curl -X POST http://localhost:3001/api/v1/auth/permissions \
  -H 'Content-Type: application/json' \
  -d '{"code":"wms.inventory.adjust","description":"Adjust inventory"}'

curl -X POST http://localhost:3001/api/v1/auth/roles \
  -H 'Content-Type: application/json' \
  -H 'X-Tenant-Id: 11111111-1111-4111-8111-111111111111' \
  -d '{"code":"inventory_manager","name":"Inventory Manager"}'

curl -X PUT http://localhost:3001/api/v1/auth/roles/{roleId}/permissions \
  -H 'Content-Type: application/json' \
  -H 'X-Tenant-Id: 11111111-1111-4111-8111-111111111111' \
  -d '{"permissionCodes":["wms.inventory.adjust"]}'

curl -X POST http://localhost:3001/api/v1/auth/users/{userId}/roles \
  -H 'Content-Type: application/json' \
  -H 'X-Tenant-Id: 11111111-1111-4111-8111-111111111111' \
  -d '{"roleId":"role-uuid","warehouseId":"warehouse-uuid"}'

curl -X POST http://localhost:3001/api/v1/auth/permissions/check \
  -H 'Content-Type: application/json' \
  -H 'X-Tenant-Id: 11111111-1111-4111-8111-111111111111' \
  -d '{"userId":"user-uuid","permission":"wms.inventory.adjust","scope":{"warehouseId":"warehouse-uuid"}}'
```

Permission code는 `{domain}.{resource}.{action}` 형식을 사용합니다. Role은 tenant-scoped이고, user-role assignment에는 optional `warehouseId` scope를 둘 수 있습니다. JWT에는 role/permission을 넣지 않습니다.

Admin scope:

- `system_admin`은 tenant-scoped role API에서 생성할 수 없습니다.
- `system.*` permission은 catalog에는 등록할 수 있지만 tenant role mapping과 tenant permission check에서는 `403 AUTH_ADMIN_SCOPE_MISMATCH`로 실패합니다.
- `tenant_admin`은 tenant 전체 scope role이며, `warehouseId`가 포함된 user-role assignment는 `403 AUTH_ADMIN_SCOPE_MISMATCH`로 실패합니다.

Internal service auth:

`GET /api/v1/auth/permissions/summary`와 `POST /api/v1/auth/permissions/check`는 내부 서비스 HMAC 인증을 요구합니다. 호출 서비스는 `X-Internal-Service-Id`, `X-Internal-Timestamp`, `X-Internal-Signature`를 전달해야 합니다.

```bash
AUTH_INTERNAL_AUTH_ENABLED=true
AUTH_INTERNAL_AUTH_SECRET=local-internal-auth-secret-change-me-32chars
AUTH_INTERNAL_AUTH_ALLOWED_SERVICES=admin-bff-service,user-bff-service,wms-service
AUTH_INTERNAL_AUTH_TIMESTAMP_SKEW_SECONDS=300
```

서명 payload는 `METHOD + "\n" + originalUrl + "\n" + timestamp + "\n" + requestId + "\n" + sha256(canonicalJsonBody)`이며, HMAC-SHA256 hex 문자열을 `X-Internal-Signature`에 넣습니다. `summary`는 `admin-bff-service`, `user-bff-service`만 허용하고, `check`는 `admin-bff-service`, `user-bff-service`, `wms-service`를 허용합니다.

Audit log:

`auth-iam-service`는 `audit_logs` 테이블을 직접 소유하지 않습니다. 사용자, role, permission, user-role 변경이 성공하면 `AUDIT_LOG_SERVICE_URL`로 설정된 별도 audit-log-service의 내부 API에 audit record 저장을 요청합니다.

```bash
AUDIT_LOG_SERVICE_URL=
```

현재 호출 경로는 `POST /api/v1/internal/audit/logs`이며 `X-Request-Id`, `X-Tenant-Id`, actor, action, resource, result, details를 전달합니다. 로컬 개발에서는 audit-log-service를 별도로 만들기 전까지 `AUDIT_LOG_SERVICE_URL`을 비워두고 audit 전송을 건너뜁니다.

Outbox event:

사용자, permission, role, role-permission, user-role 변경은 업무 변경과 같은 DB transaction 안에서 `outbox_events`에 `pending` 상태로 저장합니다. 실제 EventBridge/SQS 발행은 이후 `outbox-relay-service`가 담당합니다.

저장 이벤트는 `auth.user.created`, `auth.user.updated`, `auth.user.statusChanged`, `auth.permission.created`, `auth.role.created`, `auth.role.updated`, `auth.role.permissionsReplaced`, `auth.userRole.assigned`, `auth.userRole.removed`입니다. Payload에는 `tenantId`, `requestId`, `actor`, resource id, 상태 또는 변경 필드처럼 필요한 최소 정보만 담고 password, token, Authorization, 전체 사용자 프로필은 포함하지 않습니다.

## Prisma

PostgreSQL + Prisma를 사용합니다. Prisma는 최신 7.x 기준으로 설정하며, DB URL은 `prisma.config.ts`의 `DATABASE_URL`에서 읽습니다. 런타임 Prisma Client는 `@prisma/adapter-pg`를 사용합니다.

로컬에서 host의 다른 PostgreSQL이 `localhost:5432`를 사용 중이면 Docker Postgres 대신 host PostgreSQL로 붙을 수 있습니다. 이 경우 Docker 컨테이너 네트워크나 실제 Docker 바인딩 주소로 `DATABASE_URL`을 지정해 확인합니다.

## 운영 배포

운영 환경은 AWS PostgreSQL, 예를 들어 RDS PostgreSQL 또는 Aurora PostgreSQL, 연결 문자열을 `DATABASE_URL`로 주입합니다. `DATABASE_URL`은 plain environment 값이 아니라 Secrets Manager 또는 SSM Parameter Store secret으로 관리하고 ECS task secret으로 전달합니다.

이미지 빌드는 `DATABASE_URL` 없이도 가능해야 하므로 `build` script가 `prisma generate`를 실행할 때 `prisma.config.ts`의 fallback URL을 사용합니다. 실제 DB 연결은 런타임의 `DATABASE_URL` secret으로만 확인하며, `/ready`는 PostgreSQL과 Redis 연결을 모두 검사합니다.
