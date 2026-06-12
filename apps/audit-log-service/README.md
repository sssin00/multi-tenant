# audit-log-service

사용자와 관리자의 중요한 업무 행위를 append-only 감사 로그로 저장하고 조회합니다.

외부 조회 요청은 `gateway-service` -> `admin-bff-service` -> `audit-log-service` 순서로 처리하고, 저장 요청은 내부 서비스 인증을 사용하는 internal API로 받습니다.

## Scripts

- `pnpm --filter audit-log-service dev`: NestJS 개발 서버를 실행합니다.
- `pnpm --filter audit-log-service typecheck`: TypeScript 타입 검사를 실행합니다.
- `pnpm --filter audit-log-service build`: `dist` 빌드를 생성합니다.

## Environment

- `AUDIT_PORT`: 서비스 포트. 기본값은 `3006`입니다.
- `AUDIT_INTERNAL_AUTH_SECRET`: internal API 인증에 사용할 32자 이상 secret입니다.
- `AUDIT_INTERNAL_AUTH_ALLOWED_SERVICES`: 감사 로그 내부 API를 호출할 수 있는 서비스 목록입니다.
