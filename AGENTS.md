# Codex Project Rules

이 저장소에서 Codex가 작업할 때 따를 공통 규칙입니다.

## Project

- 프로젝트는 멀티테넌트 스마트 팩토리이며, 첫 메인 도메인은 WMS입니다.
- 문서 시작점은 `docs/index.html`입니다.
- 공통 규칙 허브는 `docs/design/project-rules.html`입니다.
- 설계 문서는 `docs/design/`, 개발과정 문서는 `docs/development/` 아래에 둡니다.
- 서비스 구현이 진행되면 해당 서비스 문서 `docs/development/services/{service}.html`을 함께 갱신합니다.
- 아키텍처 구조가 바뀌면 관련 설계 문서와 `docs/design/smart-factory-aws-ecs.drawio`를 함께 갱신합니다.
- Codex가 계속 따라야 하는 작업 기준이 바뀌면 `AGENTS.md`도 함께 갱신합니다.

## Naming

- Directory/File: `kebab-case`
- Class/Type/Interface: `PascalCase`
- Function/Variable: `camelCase`
- Constant/Environment variable: `UPPER_SNAKE_CASE`
- API URL: `/api/{surface}/{domain}/{resource}`, `kebab-case`, plural resource
- Event name: `{domain}.{resource}.{pastAction}`, `dot.case`, past tense
- AWS resource name: `{project}-{env}-{resource}`
- Branch: `type/short-description`
- Commit: Conventional Commits, e.g. `feat(wms): add inventory adjustment`
- Commit messages must be detailed by default. Use a Conventional Commit subject plus a body that summarizes key changes, affected areas, and verification results. Single-line commit messages are allowed only for truly trivial changes.
- For broad changes, write commit bodies with short bullet points such as `Changes`, `Docs`, and `Verification`. If tests were not run, state that explicitly.
- TypeScript interfaces use `PascalCase` without an `I` prefix.
- NestJS file suffixes should follow local type: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `*.repository.ts`, `*.dto.ts`, `*.entity.ts`, `*.event.ts`, `*.guard.ts`, `*.middleware.ts`, `*.interceptor.ts`, `*.policy.ts`.

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
- Backend services use NestJS + TypeScript. Frontend apps use React + Vite.
- Apps run on AWS ECS Fargate. Infrastructure is managed from `infra/cdk` with AWS CDK TypeScript.
- The initial tenant storage strategy is shared DB plus `tenantId`; schema/database separation is a later decision.

## Multi-Tenant Rules

- Every business API must have tenant context. Exceptions are login, token refresh, health check, public config, and tenant bootstrap APIs.
- For authenticated requests, JWT `tenantId` is the source of truth.
- If `X-Tenant-Id` is present, it must match JWT `tenantId`.
- Tenant mismatch must fail with `403 TENANT_MISMATCH`.
- Only `active` tenants may use business APIs.
- `gateway-service` resolves tenant context and propagates it to internal services.
- Internal services use propagated tenant context, but must revalidate required permission and scope before important business actions.
- Every tenant-scoped request, log, event, audit record, and data access path must carry `tenantId` and `requestId`.
- Tenant-owned data access must always be constrained by `tenantId`.
- Redis keys and S3 object keys must include tenant identifiers.
- `system_admin` and `tenant_admin` must remain separate administrative scopes.
- Tenant isolation tests must cover missing tenant, tenant mismatch, cross-tenant access, inactive tenant access, and event/log tenant propagation.
- Tenant proxy access is not provided until approval, audit log, and permission restriction rules are defined.

## API Response Rules

- Request/response bodies use JSON.
- JSON keys and query parameters use `camelCase`.
- Date/time values use ISO 8601 UTC strings.
- Standard headers are `Authorization`, `Content-Type`, `Accept`, `X-Request-Id`, and `X-Tenant-Id`.
- POST endpoints with duplicate execution risk must use the `Idempotency-Key` header.
- All responses include top-level `success`, `requestId`, and `timestamp`.
- Successful single-item responses use top-level `data` as an object or `null`.
- Successful list responses use `data.items`, `data.page`, `data.size`, and `data.total` only.
- List pagination starts at page `1`; default page size is `20`, and recommended maximum page size is `100`.
- Do not use a `meta` response field.
- Failed responses use top-level `error` with `code`, `message`, and optional `details`.
- Validation errors use `error.details.fields`.
- Error codes use `UPPER_SNAKE_CASE`.

## Error Code Rules

- Clients must branch on `error.code`, not `error.message`.
- Common error codes may be short, e.g. `VALIDATION_FAILED`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INTERNAL_SERVER_ERROR`.
- Domain error codes should prefer `{DOMAIN}_{RESOURCE}_{REASON}`, e.g. `WMS_INSUFFICIENT_STOCK`, `WMS_OUTBOUND_ALREADY_SHIPPED`.
- Auth errors use the `AUTH_` prefix, e.g. `AUTH_INVALID_TOKEN`, `AUTH_TOKEN_EXPIRED`.
- Tenant errors use the `TENANT_` prefix, e.g. `TENANT_REQUIRED`, `TENANT_MISMATCH`, `TENANT_NOT_READY`.
- `message` is a default explanation only. User-facing localized copy should live in the frontend or a message catalog.
- `details` may include validation fields, business hints, or external reference values, but must not include secrets, SQL, stack traces, or sensitive data.
- Error logs must include `requestId`, `tenantId`, `userId` when available, and `error.code`.
- HTTP status mapping should stay consistent: 400 validation/request errors, 401 authentication, 403 permission or tenant access, 404 missing resources, 409 conflicts, 422 business rule violations, 429 rate limits, 500 internal errors, 503 unavailable or not-ready services.

## Auth Rules

- Access tokens use JWT.
- Access tokens should default to a 30-minute expiration.
- Refresh tokens use opaque tokens and should be stored server-side.
- Refresh tokens should default to a 14-day expiration.
- Refresh token rotation must issue a new token and revoke the previous token when refresh is used.
- JWT claims include only `sub`, `tenantId`, `type`, `iat`, `exp`, `iss`, and `aud`.
- Do not put `roles` or `permissions` in JWT claims.
- `auth-iam-service` is the source of truth for roles and permissions.
- `gateway-service` validates JWT signature/expiration, extracts `sub` and `tenantId`, and blocks basic tenant mismatch.
- BFF services may fetch role/permission summaries for menu and button visibility.
- Domain services must validate required permissions before executing business actions.
- Permission names use `{domain}.{resource}.{action}`, e.g. `wms.inventory.adjust`.
- RBAC is the initial permission model. ABAC is a later extension.

## Logging And Audit Rules

- System logs and audit logs have different purposes and must not be treated as the same record.
- System logs are JSON structured logs for operations, errors, performance, integrations, and request tracing.
- System log common fields are `timestamp`, `level`, `service`, `env`, `requestId`, `tenantId`, `userId`, and `message`.
- Request logs include `method`, `path`, `statusCode`, and `durationMs`.
- Error logs include `errorCode`, `operation`, `resourceType`, and `resourceId` when available.
- Audit logs are append-only business action records and include `auditId`, `occurredAt`, `tenantId`, `actor`, `action`, `resource`, `result`, and `requestId`.
- Audit log targets include permission changes, tenant setting changes, user changes, inventory adjustments, inbound confirmations, outbound allocations, outbound confirmations, and manual ERP retries.
- List reads, simple detail reads, searches, screen entry, health checks, and internal polling are not audit log targets by default.
- Do not log `password`, `accessToken`, `refreshToken`, `Authorization`, cookies, secrets, API keys, private keys, SQL, or stack traces in API responses.
- Mask personal information such as email, phone number, and business registration number when logs need identifiers.

## Event And Outbox Rules

- Events describe facts that already happened. Do not name events as commands.
- Events must include `eventId`, `eventType`, `schemaVersion`, `tenantId`, `requestId`, `occurredAt`, `source`, and `data`.
- Optional event fields are `actor`, `correlationId`, `causationId`, and `traceId`.
- Event payloads contain only the minimum data consumers need. Do not include secrets, tokens, passwords, full user profiles, full permission lists, or large attachments.
- WMS first events are `wms.inventory.adjusted`, `wms.inbound.confirmed`, `wms.outbound.allocated`, and `wms.outbound.shipped`.
- Domain state changes and `outbox_events` inserts must happen in the same DB transaction.
- `outbox-relay-service` publishes pending events to EventBridge or SQS and records published or failed state.
- Event consumers must be idempotent by `eventId`, retryable, and must not directly modify another service's DB.
- Use `aggregateId` when event ordering matters.
- `schemaVersion` is required. Field additions may keep the same version; field deletion, type changes, or semantic changes require a version increase.

## Environment And Secret Rules

- Environment variables use `UPPER_SNAKE_CASE`.
- Common settings may be unprefixed, e.g. `APP_ENV`, `LOG_LEVEL`, `AWS_REGION`.
- Service-specific settings use service prefixes, e.g. `WMS_`, `AUTH_`, `TENANT_`, `GATEWAY_`, `BFF_`, `OUTBOX_`, `ERP_`.
- Service URL variables use `{SERVICE_NAME}_SERVICE_URL`, e.g. `AUTH_IAM_SERVICE_URL`, `TENANT_SERVICE_URL`, `WMS_SERVICE_URL`, `USER_BFF_SERVICE_URL`, `ADMIN_BFF_SERVICE_URL`.
- Environment files must use only `.env.local`, `.env.dev`, `.env.staging`, or `.env.prod`.
- Do not create `.env.example` or other environment file names.
- Real secret values must not be committed; use placeholders locally and AWS Secrets Manager or SSM Parameter Store for deployed secrets.
- Services validate environment variables at startup. Prefer schema validation such as `zod`.
- Defaults must live in the config module or schema, not scattered through implementation code.
- In ECS task definitions, non-secret settings use `environment`; secrets use `secrets`.
- Manage secrets with AWS Secrets Manager or SSM Parameter Store. Do not log secret values.

## Security And AWS Rules

- Business APIs require authentication by default. Public APIs must be explicitly declared.
- Authorization is handled through `auth-iam-service` or a permission checker.
- Internal service calls must use internal call authentication and must not trust only an external user token.
- Production CORS must list allowed origins explicitly and must not use wildcard origins.
- External gateway traffic uses ALB HTTPS with ACM. HTTP must redirect to HTTPS when the HTTPS listener is enabled.
- Route53 is not configured yet. Until a hosted zone is introduced, gateway DNS records are managed outside CDK and point to the ALB DNS name.
- ACM certificates for ALB must be in the same AWS region as the ALB.
- Admin APIs use a separate surface such as `/api/admin`.
- Rate limiting is applied at `gateway-service`.
- File uploads validate extension, MIME type, and size.
- S3 objects are not public by default; use pre-signed URLs for access.
- AWS resources are managed with CDK. Manually created resources are exceptions and must be documented.
- AWS environments are separated as `dev`, `staging`, and `prod`.
- ECS service names use `{project}-{env}-{service}`.
- SQS queues use `{project}-{env}-{purpose}-queue`.
- EventBridge buses use `{project}-{env}-event-bus`.
- S3 buckets use `{project}-{env}-{purpose}-{accountOrRegion}` because names must be globally unique.
- CloudWatch log groups are service-specific, e.g. `/multi-tenant/dev/wms-service`.
- IAM roles are separated by service and follow least privilege.
- Production removal policies must be conservative for data-loss-sensitive resources.

## Deployment Rules

- GitHub Actions automatic push deploys are temporarily disabled. Deployment workflows must be run manually with `workflow_dispatch` until automatic deploys are explicitly re-enabled.
- When automatic deploys are re-enabled, branch mapping should be `dev` to `dev`, `staging` to `staging`, and `main` to `prod`.
- GitHub deployment environments must be named `dev`, `staging`, and `prod`.
- AWS authentication in GitHub Actions uses OIDC and an environment secret named `AWS_ROLE_ARN`.
- Runtime secrets are injected through AWS Secrets Manager or SSM Parameter Store references, not plain GitHub Action environment values.
- Service-specific deployment workflows update the shared CDK stack. Non-target service desired counts and image tags must be explicit inputs or environment variables; workflows must not silently default another running service to `0` or `latest`.
- Desired count inputs must be validated as non-negative integers before CDK deploy.
- Gateway Docker image tags use `{env}-{gitSha12}`.

## Testing Rules

- First-phase verification prefers scenario-based AI testing over writing Playwright E2E automation.
- Do not add E2E automation unless the project explicitly decides to.
- Test scenarios include `scenarioId`, `title`, `priority`, `preconditions`, `steps`, `expectedResult`, and `evidence`.
- Required verification areas are multi-tenant isolation, API envelopes, error codes, WMS core workflows, outbox storage, and audit log storage.
- AI verification must follow the scenario steps and should not declare success without evidence.
- Evidence may include response JSON, screen state, logs, `requestId`, outbox rows, audit logs, or DB confirmation.
- On failure, record actual result, expected result, reproduction steps, and related `requestId`.
- External AWS/ERP production resources must not be called in tests. Use mock, local, or dev environments.
- After fixes, rerun the same scenario to verify regression closure.

## Documentation Rules

- Architecture or stack changes update `docs/design/*`.
- Service implementation changes update `docs/development/services/{service}.html`.
- New services must be added to `docs/index.html`.
- Common rule changes update `docs/design/project-rules.html` and the relevant `docs/design/rules/*.html` file.
- AWS configuration changes update `docs/design/aws-ecs-tech-stack.html` and, when needed, `docs/design/smart-factory-aws-ecs.drawio`.
- Event additions are recorded in the relevant rules document or service development document with event name and payload.
- Test scenario additions are recorded in the service development document with scenario details and evidence criteria.
