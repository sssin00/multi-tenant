# Codex Project Rules

이 저장소에서 Codex가 작업할 때 따를 공통 규칙입니다.

## Project

- 프로젝트는 멀티테넌트 스마트 팩토리이며, 첫 메인 도메인은 WMS입니다.
- 문서 시작점은 `docs/index.html`입니다.
- 설계 문서는 `docs/design/`, 개발과정 문서는 `docs/development/` 아래에 둡니다.
- 서비스 구현이 진행되면 해당 서비스 문서 `docs/development/services/{service}.html`을 함께 갱신합니다.

## Naming

- Directory/File: `kebab-case`
- Class/Type/Interface: `PascalCase`
- Function/Variable: `camelCase`
- Constant/Environment variable: `UPPER_SNAKE_CASE`
- API URL: `kebab-case`, plural resource
- Event name: `dot.case`, past tense
- AWS resource name: `{project}-{env}-{resource}`
- Branch: `type/short-description`
- Commit: Conventional Commits, e.g. `feat(wms): add inventory adjustment`

## Architecture Rules

- Apps live in `apps/*`; shared code lives in `packages/*`; AWS CDK lives in `infra/cdk`.
- Design docs live in `docs/design`; development logs live in `docs/development`.
- Place code close to where it is used. Move code to `packages/*` only when multiple apps need it.
- NestJS domain modules should keep controller, service, repository, dto, events, and tests under the domain folder.
- Services must not import another service's internal source code.
- Cross-service interaction must happen through API clients or events.
- Shared packages must not contain service-specific business rules.
- BFF services may aggregate screen data, but must not own domain business rules.
- `gateway-service` must not contain domain business logic or direct DB access.
- WMS business rules belong in `wms-service`.

## Multi-Tenant Rules

- Every tenant-scoped request, log, event, and DB query must carry `tenant_id`.
- Every request should carry or receive a `request_id`.
- Events must include `eventId`, `eventType`, `schemaVersion`, `tenantId`, `occurredAt`, `source`, and `data`.

## Documentation Rules

- Architecture or stack changes update `docs/design/*`.
- Service implementation changes update `docs/development/services/{service}.html`.
- New services must be added to `docs/index.html`.
