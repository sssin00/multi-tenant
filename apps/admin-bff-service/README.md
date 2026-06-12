# admin-bff-service

운영자 화면에 필요한 테넌트, 권한, 설정, 감사 로그 API를 조합합니다.

API 상세 계약은 `docs/apis/admin-bff-service/index.html`에 정리합니다. 구현 진행 기록과 검증 기준은 `docs/development/services/admin-bff-service.html`을 함께 갱신합니다.

## 로컬 실행

```bash
pnpm --filter admin-bff-service dev
```

기본 포트는 `ADMIN_BFF_PORT`로 설정하며, 기본값은 `3000`입니다. gateway-service와 함께 로컬에서 실행할 때는 포트 충돌을 피하기 위해 `ADMIN_BFF_PORT=3003`처럼 별도 포트를 사용합니다.

## 검증

```bash
pnpm --filter admin-bff-service typecheck
pnpm --filter admin-bff-service build
```

Health check:

```bash
curl http://localhost:3003/health
curl http://localhost:3003/ready
```

`/ready`는 config, downstream URL, internal auth secret, CORS/security 기준을 확인합니다. Admin BFF는 직접 DB에 접근하지 않으므로 readiness에 DB check를 넣지 않습니다.

## Environment

```bash
ADMIN_BFF_PORT=3003
APP_ENV=local
AUTH_IAM_SERVICE_URL=http://localhost:3001
TENANT_SERVICE_URL=http://localhost:3002
ADMIN_BFF_INTERNAL_AUTH_ENABLED=true
AUTH_INTERNAL_AUTH_SECRET=replace-with-local-internal-secret-32chars
TENANT_INTERNAL_AUTH_SECRET=replace-with-local-internal-secret-32chars
AUDIT_LOG_SERVICE_URL=
AUDIT_INTERNAL_AUTH_SECRET=replace-with-local-internal-secret-32chars
```

Admin BFF가 auth-iam-service와 tenant-service의 internal API를 호출할 때는 수신 서비스의 internal auth secret으로 HMAC 서명을 생성합니다. 서명 payload는 `METHOD + "\n" + originalUrl + "\n" + timestamp + "\n" + requestId + "\n" + sha256(canonicalJsonBody)`입니다.

## Tenant internal client

`TenantInternalClient`는 tenant-service 내부 API 호출을 담당합니다.

Admin BFF는 요청 tenant의 상태를 `GET /internal/tenants/{tenantId}/status`로 확인하고, `active` tenant만 관리자 API를 통과시킵니다.

Tenant 목록, 생성, 상세, 기본 정보 수정, 상태 변경, module 교체, domain 조회/추가/비활성화는 controller에서 연결되어 있습니다.

현재 외부 tenant 관리 API는 `GET/POST /api/admin/tenants`, `GET/PATCH /api/admin/tenants/{tenantId}`, `PATCH /api/admin/tenants/{tenantId}/status`, `PUT /api/admin/tenants/{tenantId}/modules`, `GET/POST /api/admin/tenants/{tenantId}/domains`, `DELETE /api/admin/tenants/{tenantId}/domains/{domainId}`를 제공합니다. 각 API는 `@AdminPermission`으로 Auth/IAM permission check를 수행한 뒤 tenant-service 내부 API로 위임합니다.

## User, role, permission API

Admin BFF는 사용자, role, permission 화면 API를 `auth-iam-service`로 위임합니다.

- `GET /api/admin/access-control/screen-data`
- `GET/POST/PATCH/DELETE /api/admin/users/**`
- `GET/POST/PATCH /api/admin/roles/**`
- `PUT /api/admin/roles/{roleId}/permissions`
- `GET/POST /api/admin/permissions`
- `POST /api/admin/users/{userId}/roles`
- `DELETE /api/admin/user-roles/{userRoleId}`

화면 초기 데이터 API는 사용자 목록, role 목록, permission 목록을 병렬 조회해 `users`, `roles`, `permissions`로 반환하며 세 read permission을 모두 확인합니다. 사용자 상세 API는 사용자 상세와 user-role 목록을 함께 조합해 반환합니다. 변경성 요청은 `Idempotency-Key` header가 필수입니다.

## Audit log API

`GET /api/admin/audit-logs`는 `audit.logs.read` permission check 후 audit-log-service의 `GET /api/internal/audit/logs`로 위임하도록 준비되어 있습니다. `AUDIT_LOG_SERVICE_URL`이 비어 있으면 저장소 미준비 상태로 보고 `503 AUDIT_LOG_SERVICE_NOT_CONFIGURED`를 반환합니다.

`AUDIT_LOG_SERVICE_URL`을 설정하는 환경에서는 `AUDIT_INTERNAL_AUTH_SECRET`도 함께 설정해야 readiness가 통과합니다.

## Permission check

관리자 API controller에는 `@AdminPermission("tenant.tenants.create")`처럼 permission decorator를 붙입니다. 전역 `AdminPermissionGuard`는 decorator가 있는 route에서만 auth-iam-service의 `POST /api/auth/permissions/check`를 internal auth로 호출합니다.

권한 check에는 gateway가 전파한 `X-Tenant-Id`와 `X-User-Id`가 필요합니다. 누락 시 각각 `TENANT_REQUIRED`, `UNAUTHORIZED` envelope로 실패합니다.

## Infrastructure

컨테이너는 `apps/admin-bff-service/Dockerfile`로 빌드합니다. ECS 기준 포트는 `3000`이고 CloudWatch log group은 서비스별 규칙에 맞춰 `/multi-tenant/{env}/admin-bff-service`를 사용합니다. gateway-service는 `/api/admin/**` 요청을 `/api/admin` base path를 포함한 `ADMIN_BFF_SERVICE_URL`로 전달합니다.
