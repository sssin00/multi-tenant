# user-bff-service

WMS 사용자 화면과 PDA Web에 필요한 API를 조합하는 NestJS BFF입니다.

## 역할

- 외부 사용자 업무 API surface는 `/api/app/**`를 사용합니다.
- gateway-service가 JWT와 tenant mismatch를 1차 검증한 뒤 user-bff-service로 proxy합니다.
- user-bff-service는 tenant-service로 tenant active/module 상태를 확인하고, auth-iam-service로 permission summary/check를 조회합니다.
- WMS 업무 규칙은 wms-service에 두고, user-bff-service는 화면 데이터 조합과 응답 shape만 담당합니다.
- app shell 감사 이벤트는 EventBridge 또는 audit-log-service 내부 기록 API fallback으로 best-effort 저장합니다.

## Scripts

```bash
pnpm --filter user-bff-service dev
pnpm --filter user-bff-service typecheck
pnpm --filter user-bff-service build
pnpm --filter user-bff-service start
```

## Endpoints

- `GET /health`
- `GET /ready`
- `GET /api/app/me`
- `GET /api/app/navigation`
- `GET /api/app/wms/warehouses`
- `GET /api/app/wms/materials`
- `GET /api/app/wms/inventory-summary`
- `GET /api/app/wms/dashboard`

`GET /api/app/me` 성공 시 `userBff.appContext.loaded`, `GET /api/app/navigation` 성공 시 `userBff.navigation.loaded` 감사 이벤트 발행을 시도합니다. EventBridge 또는 audit-log-service 장애는 원 API 응답을 막지 않고 warning log로만 남깁니다.

## Local

Docker compose에서는 host port를 열지 않고 compose 내부 네트워크에만 노출합니다. 로컬 브라우저와 Postman 요청은 항상 gateway 경유 `http://localhost:3000/api/app/**`를 사용합니다.

필수 downstream 환경 변수는 `AUTH_IAM_SERVICE_URL`, `TENANT_SERVICE_URL`, `WMS_SERVICE_URL`입니다. 내부 인증이 켜져 있으면 `AUTH_INTERNAL_AUTH_SECRET`, `TENANT_INTERNAL_AUTH_SECRET`, `WMS_INTERNAL_AUTH_SECRET`도 필요합니다.

App audit publisher는 `USER_BFF_APP_AUDIT_PUBLISHER_TYPE=eventbridge|internal-api|disabled`로 선택합니다. EventBridge 모드는 `USER_BFF_AUDIT_EVENTBRIDGE_BUS_NAME`이 필요하고, internal-api 모드는 `AUDIT_LOG_SERVICE_URL`과 `AUDIT_INTERNAL_AUTH_SECRET`이 필요합니다.
