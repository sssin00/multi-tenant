# Infra

AWS 인프라 코드를 관리합니다.

ECS, ECR, ALB, VPC, Redis, IAM, Security Group, 감사 이벤트용 SQS queue/DLQ 등은 CDK로 재현 가능하게 관리합니다.
RDS/Aurora, EventBridge bus, 비감사 SQS queue/DLQ, S3, Route53 record는 아직 현재 CDK 스택에 포함되어 있지 않으며, DB는 Secrets Manager의 기존 `DATABASE_URL` 또는 source별 outbox DB URL secret을 참조합니다.

## gateway-service/auth-iam-service/tenant-service/admin-bff-service/audit-log-service/outbox-relay-service 1차 배포 흐름

현재 CDK는 `gateway-service`, `auth-iam-service`, `tenant-service`, `admin-bff-service`, `audit-log-service`, `outbox-relay-service` 배포를 위한 최소 dev 인프라를 생성합니다.

- ECR repository per service
- VPC public/private subnets
- ECS cluster
- ECS Fargate task definition/service per service
- ALB listener/target group
- Cloud Map private DNS namespace
- ElastiCache Redis for gateway rate limit, auth cache/session, tenant cache dependency
- Audit event SQS queue and DLQ for outbox-relay-service to audit-log-service delivery
- CloudWatch log group per service
- Security groups

첫 CDK 배포는 ECR repository를 먼저 만들 수 있도록 `gatewayDesiredCount=0`, `authDesiredCount=0`, `tenantDesiredCount=0`, `adminBffDesiredCount=0`, `auditDesiredCount=0`, `outboxDesiredCount=0`을 기본값으로 사용합니다.
이미지를 ECR에 push하고 runtime secret을 준비한 뒤 desired count를 올려 서비스를 실행합니다.
CDK context의 desired count 값은 0 이상의 정수만 허용하며, 잘못된 값은 synth/deploy 전에 실패합니다.

기본 구성은 private subnet + NAT Gateway 배치입니다. dev 계정의 Elastic IP 한도 때문에 NAT Gateway를 만들 수 없을 때는 `-c gatewayUseNatGateway=false`를 붙여 임시로 public subnet에 Fargate task를 배치할 수 있습니다. 이 경우에도 task ingress는 ALB security group에서 오는 `3000` 포트만 허용합니다.

gateway-service rate limit 저장소와 auth-iam-service/tenant-service cache 의존성은 AWS 배포에서 ElastiCache Redis를 사용합니다. CDK는 app subnet에 Redis subnet group을 만들고, gateway-service/auth-iam-service/tenant-service security group에서 Redis `6379` 포트로만 접근하도록 제한합니다. 기본 노드 타입은 `cache.t4g.micro`이며 `-c gatewayRedisNodeType=...`으로 조정할 수 있습니다.

auth-iam-service는 ALB target으로 직접 노출하지 않습니다. gateway-service가 Cloud Map 내부 DNS와 auth base path를 포함한 `http://auth-iam-service.{envName}.multi-tenant.local:3000/api/auth`로 호출하고, 외부 요청은 gateway의 `/api/auth/**` proxy route를 통해 전달합니다.
tenant-service도 ALB target으로 직접 노출하지 않습니다. gateway-service는 tenant-service를 직접 호출하지 않고, Admin BFF가 Cloud Map 내부 DNS인 `http://tenant-service.{envName}.multi-tenant.local:3000`으로 tenant 상태 확인과 tenant 관리 내부 API를 호출합니다.
admin-bff-service도 ALB target으로 직접 노출하지 않습니다. gateway-service가 Cloud Map 내부 DNS와 admin base path를 포함한 `http://admin-bff-service.{envName}.multi-tenant.local:3000/api/admin`으로 `/api/admin/**` upstream을 호출합니다.
audit-log-service도 ALB target으로 직접 노출하지 않습니다. 감사 로그 저장은 각 서비스의 outbox event 발행과 audit-log-service consumer로 처리하고, admin-bff-service만 Cloud Map 내부 DNS인 `http://audit-log-service.{envName}.multi-tenant.local:3000`으로 감사 로그 조회 API를 호출합니다. `auditDesiredCount=0`이면 admin-bff-service의 `AUDIT_LOG_SERVICE_URL`은 빈 값으로 주입되며, `auditDesiredCount>0`이거나 `auditLogServiceUrl` override를 지정한 경우 조회용 audit internal auth secret ARN이 필요합니다.
outbox-relay-service도 ALB target으로 직접 노출하지 않습니다. source DB의 `outbox_events`를 polling해 mock/EventBridge/SQS publisher로 발행하며, 기본 AWS SQS 대상은 CDK가 생성하는 audit event queue입니다. Cloud Map 내부 DNS인 `http://outbox-relay-service.{envName}.multi-tenant.local:3007`로 운영 API를 제공하고, gateway-service는 outbox-relay-service를 직접 호출하지 않으며, CDK 보안 그룹은 admin-bff-service에서 outbox-relay-service 3007 포트 접근만 허용합니다.

## gateway-service HTTPS, ACM, DNS 연결

Route53 hosted zone이 아직 준비되지 않았기 때문에 CDK는 DNS record를 직접 만들지 않습니다.
대신 ACM 인증서 ARN이 전달되면 ALB에 HTTPS `443` listener를 만들고, HTTP `80` listener는 HTTPS로 리다이렉트합니다.

```bash
pnpm --filter @multi-tenant/infra-cdk exec cdk deploy \
  -c envName=dev \
  -c gatewayDesiredCount=1 \
  -c gatewayAcmCertificateArn=arn:aws:acm:ap-northeast-2:{account_id}:certificate/{certificate_id} \
  -c gatewayDomainName=api-dev.example.com
```

ACM 인증서는 ALB와 같은 region에 있어야 합니다. 현재 CDK 기본 region은 `ap-northeast-2`입니다.

Route53을 나중에 도입하면 hosted zone을 CDK에 연결해 `A/AAAA Alias` record를 ALB로 생성합니다.
Route53을 사용하지 않는 동안에는 사용 중인 DNS 제공자에서 `gatewayDomainName`을 ALB DNS 이름으로 연결합니다. `gatewayDomainName`을 CDK context로 전달한 경우 `GatewayDnsTarget` output도 함께 생성됩니다.
루트 도메인은 DNS 제공자가 ALIAS/ANAME을 지원해야 하며, 그렇지 않으면 `api-dev.example.com` 같은 subdomain에 `CNAME`을 사용합니다.

```bash
# 1. CDK bootstrap이 안 되어 있다면 먼저 실행
pnpm --filter @multi-tenant/infra-cdk exec cdk bootstrap

# 2. ECR/ECS/ALB 인프라 생성, 서비스 desired count는 0
pnpm infra:deploy

# 2-a. Elastic IP 한도 때문에 NAT Gateway 생성이 막힌 dev 계정에서만 사용
pnpm --filter @multi-tenant/infra-cdk exec cdk deploy \
  -c gatewayDesiredCount=0 \
  -c authDesiredCount=0 \
  -c tenantDesiredCount=0 \
  -c adminBffDesiredCount=0 \
  -c auditDesiredCount=0 \
  -c outboxDesiredCount=0 \
  -c gatewayUseNatGateway=false

# 3. 출력된 RepositoryUri로 linux/amd64 이미지 push
aws ecr get-login-password --region ap-northeast-2 \
  | docker login --username AWS --password-stdin {account_id}.dkr.ecr.ap-northeast-2.amazonaws.com

docker buildx build \
  --platform linux/amd64 \
  -f apps/gateway-service/Dockerfile \
  -t {GatewayServiceRepositoryUri}:latest \
  --push .

docker buildx build \
  --platform linux/amd64 \
  -f apps/auth-iam-service/Dockerfile \
  -t {AuthIamServiceRepositoryUri}:latest \
  --push .

docker buildx build \
  --platform linux/amd64 \
  -f apps/tenant-service/Dockerfile \
  -t {TenantServiceRepositoryUri}:latest \
  --push .

docker buildx build \
  --platform linux/amd64 \
  -f apps/admin-bff-service/Dockerfile \
  -t {AdminBffServiceRepositoryUri}:latest \
  --push .

docker buildx build \
  --platform linux/amd64 \
  -f apps/audit-log-service/Dockerfile \
  -t {AuditLogServiceRepositoryUri}:latest \
  --push .

docker buildx build \
  --platform linux/amd64 \
  -f apps/outbox-relay-service/Dockerfile \
  -t {OutboxRelayServiceRepositoryUri}:latest \
  --push .

# 4. 이미지와 secret 준비 후 desired count를 올려 재배포
pnpm --filter @multi-tenant/infra-cdk deploy \
  -c gatewayDesiredCount=1 \
  -c authDesiredCount=1 \
  -c tenantDesiredCount=1 \
  -c adminBffDesiredCount=1 \
  -c auditDesiredCount=1 \
  -c outboxDesiredCount=1 \
  -c gatewayUseNatGateway=false \
  -c gatewayImageTag=latest \
  -c authImageTag=latest \
  -c tenantImageTag=latest \
  -c adminBffImageTag=latest \
  -c auditImageTag=latest \
  -c outboxImageTag=latest \
  -c gatewayJwtSecretArn={gateway_jwt_secret_arn} \
  -c authDatabaseUrlSecretArn={auth_database_url_secret_arn} \
  -c authJwtSecretArn={auth_jwt_secret_arn} \
  -c authInternalAuthSecretArn={auth_internal_auth_secret_arn} \
  -c tenantDatabaseUrlSecretArn={tenant_database_url_secret_arn} \
  -c tenantInternalAuthSecretArn={tenant_internal_auth_secret_arn} \
  -c adminBffAuthInternalAuthSecretArn={admin_bff_auth_internal_auth_secret_arn} \
  -c adminBffTenantInternalAuthSecretArn={admin_bff_tenant_internal_auth_secret_arn} \
  -c auditDatabaseUrlSecretArn={audit_database_url_secret_arn} \
  -c auditInternalAuthSecretArn={audit_internal_auth_secret_arn} \
  -c authIamOutboxDatabaseUrlSecretArn={auth_iam_outbox_database_url_secret_arn} \
  -c tenantOutboxDatabaseUrlSecretArn={tenant_outbox_database_url_secret_arn} \
  -c auditEventConsumerEnabled=true \
  -c outboxPublisherType=sqs
```

배포 후 CDK output의 `GatewayLoadBalancerDns`로 health check를 확인합니다.

```bash
curl http://{GatewayLoadBalancerDns}/health
```

HTTPS listener를 활성화한 경우에는 도메인 연결 후 아래처럼 확인합니다.

```bash
curl https://{GatewayDomainName}/health
```

## gateway-service GitHub Actions 수동 배포

`deploy-gateway-service.yml`의 push 자동 배포는 당분간 비활성화되어 있으며, GitHub Actions에서 수동 실행(`workflow_dispatch`)할 때만 배포합니다.
수동 실행 시에는 선택한 브랜치 기준으로 배포 환경을 고정하고 gateway-service 이미지만 build/push합니다.
같은 CDK 스택 안의 auth-iam-service, tenant-service, admin-bff-service, audit-log-service, outbox-relay-service 리소스 및 task definition context도 함께 갱신되므로, 해당 서비스의 desired count와 image tag는 GitHub Environment variable에 반드시 명시해야 합니다.
Auth/IAM 실행 배포는 `deploy-auth-iam-service.yml`, Tenant 실행 배포는 `deploy-tenant-service.yml`, Admin BFF 실행 배포는 `deploy-admin-bff-service.yml`, Audit Log 실행 배포는 `deploy-audit-log-service.yml`, Outbox Relay 실행 배포는 `deploy-outbox-relay-service.yml`에서 별도로 처리합니다.

### 배포 workflow 요약

여섯 workflow는 모두 같은 CDK 스택(`multi-tenant-{env}-gateway-service-stack`)을 갱신합니다.
자동 push 배포는 꺼져 있으며, GitHub Actions 화면에서 수동 실행해야 합니다.

| Workflow | Build/push image | 대상 서비스 기본 최종 desired count | 다른 서비스 처리 | 주요 secret guard |
| --- | --- | --- | --- | --- |
| `deploy-gateway-service.yml` | gateway-service | `GATEWAY_DESIRED_COUNT=1` | `AUTH_*`, `TENANT_*`, `ADMIN_BFF_*`, `AUDIT_*`, `OUTBOX_*` 명시 필수 | desired count가 0보다 큰 모든 서비스의 runtime secret |
| `deploy-auth-iam-service.yml` | auth-iam-service | `AUTH_DESIRED_COUNT=1` | `GATEWAY_*`, `TENANT_*`, `ADMIN_BFF_*`, `AUDIT_*`, `OUTBOX_*` 명시 필수 | desired count가 0보다 큰 모든 서비스의 runtime secret |
| `deploy-tenant-service.yml` | tenant-service | `TENANT_DESIRED_COUNT=1` | `GATEWAY_*`, `AUTH_*`, `ADMIN_BFF_*`, `AUDIT_*`, `OUTBOX_*` 명시 필수 | desired count가 0보다 큰 모든 서비스의 runtime secret |
| `deploy-admin-bff-service.yml` | admin-bff-service | `ADMIN_BFF_DESIRED_COUNT=1` | `GATEWAY_*`, `AUTH_*`, `TENANT_*`, `AUDIT_*`, `OUTBOX_*` 명시 필수 | desired count가 0보다 큰 모든 서비스의 runtime secret |
| `deploy-audit-log-service.yml` | audit-log-service | `AUDIT_DESIRED_COUNT=1` | `GATEWAY_*`, `AUTH_*`, `TENANT_*`, `ADMIN_BFF_*`, `OUTBOX_*` 명시 필수 | desired count가 0보다 큰 모든 서비스의 runtime secret |
| `deploy-outbox-relay-service.yml` | outbox-relay-service | `OUTBOX_DESIRED_COUNT=1` | `GATEWAY_*`, `AUTH_*`, `TENANT_*`, `ADMIN_BFF_*`, `AUDIT_*` 명시 필수 | source DB secret과 publisher target |

중요: 여섯 workflow 모두 같은 스택을 다시 배포합니다. 비대상 서비스 값이 비어 있으면 workflow가 실패하도록 막아 두었으므로, 처음 인프라만 만들 때도 명시적으로 `0`과 사용할 image tag를 넣어야 합니다.
예를 들어 tenant만 새로 배포하면서 gateway, auth, admin-bff, audit, outbox를 계속 1개씩 유지하려면 `GATEWAY_DESIRED_COUNT=1`, `GATEWAY_IMAGE_TAG={current_gateway_tag}`, `AUTH_DESIRED_COUNT=1`, `AUTH_IMAGE_TAG={current_auth_tag}`, `ADMIN_BFF_DESIRED_COUNT=1`, `ADMIN_BFF_IMAGE_TAG={current_admin_bff_tag}`, `AUDIT_DESIRED_COUNT=1`, `AUDIT_IMAGE_TAG={current_audit_tag}`, `OUTBOX_DESIRED_COUNT=1`, `OUTBOX_IMAGE_TAG={current_outbox_tag}`를 함께 설정합니다. 해당 서비스 desired count가 0보다 크면 그 서비스의 runtime secret ARN도 같이 설정해야 합니다.

| Branch | GitHub Environment | APP_ENV/CDK envName |
| --- | --- | --- |
| `dev` | `dev` | `dev` |
| `staging` | `staging` | `staging` |
| `main` | `prod` | `prod` |

워크플로는 다음 순서로 실행합니다.

1. `gateway-service` typecheck/build
2. CDK typecheck
3. CDK deploy with target `gatewayDesiredCount=0`, and explicitly provided auth/tenant/admin-bff/audit/outbox desired counts
4. ECR repository URI 조회
5. gateway-service Docker image build/push
6. CDK deploy with target gateway desired count, and explicitly provided auth/tenant/admin-bff/audit/outbox desired counts

각 GitHub Environment에는 아래 값을 설정합니다.

### Required secrets

| Name | Description |
| --- | --- |
| `AWS_ROLE_ARN` | GitHub OIDC로 assume할 AWS IAM role ARN |
| `GATEWAY_JWT_SECRET_ARN` | ECS task에 `JWT_SECRET`으로 주입할 Secrets Manager secret ARN |

### Optional variables

| Name | Default | Description |
| --- | --- | --- |
| `AWS_REGION` | `ap-northeast-2` | CDK/ECR/ECS 배포 region |
| `GATEWAY_DESIRED_COUNT` | `1` | 최종 ECS desired count |
| `GATEWAY_USE_NAT_GATEWAY` | `true` | private subnet + NAT Gateway 사용 여부 |
| `GATEWAY_REDIS_NODE_TYPE` | `cache.t4g.micro` | ElastiCache Redis node type |
| `GATEWAY_ACM_CERTIFICATE_ARN` | empty | ALB HTTPS listener에 연결할 ACM certificate ARN |
| `GATEWAY_DOMAIN_NAME` | empty | CDK output에 표시할 gateway domain |
| `GATEWAY_CORS_ALLOWED_ORIGINS` | CDK 기본값 | 환경별 허용 CORS origin 목록 |
| `AUTH_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 auth-iam-service desired count |
| `AUTH_IMAGE_TAG` | required | auth-iam-service task definition에 기록할 image tag. 현재 workflow에서는 이 이미지를 push하지 않음 |
| `AUTH_CORS_ALLOWED_ORIGINS` | CDK 기본값 | Auth/IAM 환경별 허용 CORS origin 목록 |
| `AUTH_JWT_ALGORITHM` | `HS256` | Auth/IAM access token 서명 알고리즘 |
| `TENANT_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 tenant-service desired count |
| `TENANT_IMAGE_TAG` | required | tenant-service task definition에 기록할 image tag. 현재 workflow에서는 이 이미지를 push하지 않음 |
| `TENANT_CORS_ALLOWED_ORIGINS` | CDK 기본값 | Tenant 환경별 허용 CORS origin 목록 |
| `ADMIN_BFF_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 admin-bff-service desired count |
| `ADMIN_BFF_IMAGE_TAG` | required | admin-bff-service task definition에 기록할 image tag. 현재 workflow에서는 이 이미지를 push하지 않음 |
| `ADMIN_BFF_CORS_ALLOWED_ORIGINS` | CDK 기본값 | Admin BFF 환경별 허용 CORS origin 목록 |
| `AUDIT_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 audit-log-service desired count |
| `AUDIT_IMAGE_TAG` | required | audit-log-service task definition에 기록할 image tag. gateway/auth/tenant/admin-bff workflow에서는 이 이미지를 push하지 않습니다. audit workflow는 `{env}-{gitSha12}` tag를 직접 생성해 push합니다. |
| `AUDIT_CORS_ALLOWED_ORIGINS` | CDK 기본값 | Audit service 환경별 허용 CORS origin 목록 |
| `AUDIT_EVENT_CONSUMER_ENABLED` | `true` | audit-log-service SQS polling consumer 실행 여부 |
| `AUDIT_EVENT_QUEUE_URL` | empty | audit-log-service 소비 queue URL override. 비어 있으면 CDK 관리형 audit event queue 사용 |
| `OUTBOX_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 outbox-relay-service desired count |
| `OUTBOX_IMAGE_TAG` | required | outbox-relay-service task definition에 기록할 image tag. outbox workflow는 `{env}-{gitSha12}` tag를 직접 생성해 push합니다. |
| `OUTBOX_SOURCES` | `auth-iam,tenant` | relay polling source 목록 |
| `OUTBOX_WORKER_ENABLED` | `true` | outbox worker loop 실행 여부 |
| `OUTBOX_PUBLISHER_TYPE` | `sqs` | `mock`, `eventbridge`, `sqs` 중 하나 |
| `OUTBOX_EVENTBRIDGE_BUS_NAME` | empty | EventBridge publisher 대상 bus 이름. `OUTBOX_PUBLISHER_TYPE=eventbridge`이면 필수 |
| `OUTBOX_SQS_QUEUE_URL` | empty | SQS publisher 대상 queue URL override. 비어 있으면 CDK 관리형 audit event queue 사용 |
| `AUDIT_LOG_SERVICE_URL` | empty | admin-bff-service가 audit-log-service 조회 API를 호출할 때 사용할 내부 URL override. 비어 있고 `AUDIT_DESIRED_COUNT>0`이면 CDK가 Cloud Map URL을 주입합니다. |
| `AUTH_IAM_SERVICE_URL` | Cloud Map 내부 DNS + `/api/auth` | Auth/IAM upstream URL override. auth-iam-service 컨트롤러 경로와 맞추기 위해 `/api/auth` base path까지 포함합니다. |
| `ADMIN_BFF_SERVICE_URL` | Cloud Map 내부 DNS + `/api/admin` | Admin BFF upstream URL override. gateway proxy가 `/api/admin` prefix를 upstream base path로 치환하므로 base path까지 포함합니다. |
| `TENANT_SERVICE_URL` | Cloud Map 내부 DNS | Admin BFF가 tenant-service 내부 API를 호출할 때 사용할 URL override. gateway-service 직접 upstream으로 사용하지 않음 |

### Optional Auth/IAM context secrets

아래 secret은 gateway workflow에서도 CDK task definition context로 전달할 수 있습니다. gateway workflow에서 `AUTH_DESIRED_COUNT`를 0보다 크게 유지하려면 Auth/IAM runtime secret ARN도 함께 필요합니다.

| Name | Description |
| --- | --- |
| `AUTH_DATABASE_URL_SECRET_ARN` | Auth/IAM ECS task에 `DATABASE_URL`로 주입할 Secrets Manager secret ARN |
| `AUTH_JWT_SECRET_ARN` | HS256 JWT secret ARN |
| `AUTH_JWT_PRIVATE_KEY_SECRET_ARN` | RS256 private key secret ARN |
| `AUTH_JWT_PUBLIC_KEY_SECRET_ARN` | RS256 public key secret ARN |
| `AUTH_INTERNAL_AUTH_SECRET_ARN` | 내부 서비스 호출 인증용 secret ARN |

## audit-log-service GitHub Actions 수동 배포

`deploy-audit-log-service.yml`도 자동 push 배포 없이 수동 실행(`workflow_dispatch`)만 허용합니다.
이 workflow는 audit-log-service를 typecheck/build하고, CDK 기본 인프라를 `auditDesiredCount=0`으로 먼저 맞춘 뒤 audit Docker image를 ECR에 push하고 마지막에 `AUDIT_DESIRED_COUNT` 값으로 audit-log-service를 실행합니다.
같은 CDK 스택을 갱신하므로 gateway-service, auth-iam-service, tenant-service, admin-bff-service, outbox-relay-service의 desired count와 image tag를 GitHub Environment variable에 반드시 명시해야 합니다.

기본값은 다음과 같습니다.

| Name | Default | Description |
| --- | --- | --- |
| `AUDIT_DESIRED_COUNT` | `1` | 최종 audit-log-service ECS desired count |
| `AUDIT_IMAGE_TAG` | `{env}-{gitSha12}` | audit workflow가 생성해 push하는 audit-log-service image tag |
| `GATEWAY_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 gateway-service desired count |
| `AUTH_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 auth-iam-service desired count |
| `TENANT_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 tenant-service desired count |
| `ADMIN_BFF_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 admin-bff-service desired count |
| `OUTBOX_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 outbox-relay-service desired count |
| `GATEWAY_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 gateway-service image tag |
| `AUTH_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 auth-iam-service image tag |
| `TENANT_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 tenant-service image tag |
| `ADMIN_BFF_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 admin-bff-service image tag |
| `OUTBOX_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 outbox-relay-service image tag |

audit-log-service를 실제로 실행하려면 `AUDIT_DATABASE_URL_SECRET_ARN`과 `AUDIT_INTERNAL_AUTH_SECRET_ARN`이 필요합니다.
workflow는 `AuditLogServiceRepositoryUri` CDK output을 읽어 `apps/audit-log-service/Dockerfile` 이미지를 `linux/amd64`로 build/push하고, 두 번째 CDK deploy에서 audit desired count와 image tag를 적용합니다.

## outbox-relay-service GitHub Actions 수동 배포

`deploy-outbox-relay-service.yml`도 자동 push 배포 없이 수동 실행(`workflow_dispatch`)만 허용합니다.
이 workflow는 outbox-relay-service를 typecheck/build하고, CDK 기본 인프라를 `outboxDesiredCount=0`으로 먼저 맞춘 뒤 outbox Docker image를 ECR에 push하고 마지막에 `OUTBOX_DESIRED_COUNT` 값으로 outbox-relay-service를 실행합니다.
같은 CDK 스택을 갱신하므로 gateway-service, auth-iam-service, tenant-service, admin-bff-service, audit-log-service의 desired count와 image tag를 GitHub Environment variable에 반드시 명시해야 합니다.

기본값은 다음과 같습니다.

| Name | Default | Description |
| --- | --- | --- |
| `OUTBOX_DESIRED_COUNT` | `1` | 최종 outbox-relay-service ECS desired count |
| `OUTBOX_IMAGE_TAG` | `{env}-{gitSha12}` | outbox workflow가 생성해 push하는 outbox-relay-service image tag |
| `OUTBOX_SOURCES` | `auth-iam,tenant` | polling할 source 목록 |
| `OUTBOX_WORKER_ENABLED` | `true` | worker loop 실행 여부 |
| `OUTBOX_PUBLISHER_TYPE` | `sqs` | `mock`, `eventbridge`, `sqs` 중 하나. 기본 SQS 대상은 CDK 관리형 audit event queue |
| `GATEWAY_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 gateway-service desired count |
| `AUTH_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 auth-iam-service desired count |
| `TENANT_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 tenant-service desired count |
| `ADMIN_BFF_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 admin-bff-service desired count |
| `AUDIT_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 audit-log-service desired count |
| `GATEWAY_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 gateway-service image tag |
| `AUTH_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 auth-iam-service image tag |
| `TENANT_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 tenant-service image tag |
| `ADMIN_BFF_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 admin-bff-service image tag |
| `AUDIT_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 audit-log-service image tag |

`OUTBOX_WORKER_ENABLED=true`이고 `OUTBOX_DESIRED_COUNT`가 0보다 크면 `OUTBOX_SOURCES`에 포함된 source별 DB URL secret ARN이 필요합니다.
`OUTBOX_PUBLISHER_TYPE=eventbridge`이면 `OUTBOX_EVENTBRIDGE_BUS_NAME`이 필요합니다. `sqs`이면 기본적으로 CDK 관리형 audit event queue를 사용하므로 `OUTBOX_SQS_QUEUE_URL`은 외부 queue override가 필요한 경우에만 설정합니다.
workflow는 `OutboxRelayServiceRepositoryUri` CDK output을 읽어 `apps/outbox-relay-service/Dockerfile` 이미지를 `linux/amd64`로 build/push하고, 두 번째 CDK deploy에서 outbox desired count와 image tag를 적용합니다.

## auth-iam-service GitHub Actions 수동 배포

`deploy-auth-iam-service.yml`도 자동 push 배포 없이 수동 실행(`workflow_dispatch`)만 허용합니다.
이 workflow는 auth-iam-service를 typecheck/build하고, CDK 기본 인프라를 `authDesiredCount=0`으로 먼저 맞춘 뒤 auth Docker image를 ECR에 push하고 마지막에 `AUTH_DESIRED_COUNT` 값으로 auth-iam-service를 실행합니다.
같은 CDK 스택을 갱신하므로 gateway-service, tenant-service, admin-bff-service, audit-log-service, outbox-relay-service의 desired count와 image tag를 GitHub Environment variable에 반드시 명시해야 합니다.

기본값은 다음과 같습니다.

| Name | Default | Description |
| --- | --- | --- |
| `AUTH_DESIRED_COUNT` | `1` | 최종 auth-iam-service ECS desired count |
| `AUTH_JWT_ALGORITHM` | `HS256` | Auth/IAM access token 서명 알고리즘 |
| `GATEWAY_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 gateway-service desired count |
| `TENANT_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 tenant-service desired count |
| `ADMIN_BFF_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 admin-bff-service desired count |
| `AUDIT_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 audit-log-service desired count |
| `OUTBOX_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 outbox-relay-service desired count |
| `GATEWAY_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 gateway-service image tag |
| `TENANT_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 tenant-service image tag |
| `ADMIN_BFF_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 admin-bff-service image tag |
| `AUDIT_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 audit-log-service image tag |
| `OUTBOX_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 outbox-relay-service image tag |

auth-iam-service를 실제로 실행하려면 `AUTH_DATABASE_URL_SECRET_ARN`, `AUTH_INTERNAL_AUTH_SECRET_ARN`, 그리고 JWT 알고리즘에 맞는 secret이 필요합니다.
`HS256`은 `AUTH_JWT_SECRET_ARN`, `RS256`은 `AUTH_JWT_PRIVATE_KEY_SECRET_ARN`과 `AUTH_JWT_PUBLIC_KEY_SECRET_ARN`을 사용합니다.
workflow는 desired count가 0보다 클 때 필요한 secret이 비어 있으면 Docker push나 CDK deploy 전에 실패하도록 사전 검증합니다.

### Optional Tenant context secrets

아래 secret은 gateway/auth workflow에서도 CDK task definition context로 전달할 수 있습니다. 해당 workflow에서 `TENANT_DESIRED_COUNT`를 0보다 크게 유지하려면 Tenant runtime secret ARN도 함께 필요합니다.

| Name | Description |
| --- | --- |
| `TENANT_DATABASE_URL_SECRET_ARN` | Tenant ECS task에 `DATABASE_URL`로 주입할 Secrets Manager secret ARN |
| `TENANT_INTERNAL_AUTH_SECRET_ARN` | BFF와 tenant-service가 공유할 내부 호출 인증 secret ARN |

### Optional Admin BFF context secrets

아래 secret은 모든 workflow에서 CDK task definition context로 전달할 수 있습니다. admin-bff-service desired count를 0보다 크게 유지하려면 Auth/IAM과 Tenant 내부 호출용 secret ARN이 필요합니다.

| Name | Description |
| --- | --- |
| `ADMIN_BFF_AUTH_INTERNAL_AUTH_SECRET_ARN` | Admin BFF가 auth-iam-service 내부 API를 호출할 때 사용할 secret ARN |
| `ADMIN_BFF_TENANT_INTERNAL_AUTH_SECRET_ARN` | Admin BFF가 tenant-service 내부 API를 호출할 때 사용할 secret ARN |
| `ADMIN_BFF_AUDIT_INTERNAL_AUTH_SECRET_ARN` | `AUDIT_LOG_SERVICE_URL`이 설정된 경우 admin-bff-service가 audit-log-service 조회 API를 호출할 때 사용할 secret ARN |

### Optional Audit context secrets

아래 secret은 모든 workflow에서 CDK task definition context로 전달할 수 있습니다. audit-log-service desired count를 0보다 크게 유지하려면 두 secret ARN이 필요합니다.

| Name | Description |
| --- | --- |
| `AUDIT_DATABASE_URL_SECRET_ARN` | audit-log-service ECS task에 `DATABASE_URL`로 주입하고 Prisma migration deploy에도 사용할 Secrets Manager secret ARN |
| `AUDIT_INTERNAL_AUTH_SECRET_ARN` | audit-log-service 내부 조회 API HMAC 인증에 사용할 secret ARN. admin-bff-service에 조회 호출용 secret으로 주입되며, 이벤트 기반 저장에는 사용하지 않습니다. |

Audit event consumer 기준:

- CDK 기본값은 `AUDIT_EVENT_CONSUMER_ENABLED=true`이며, audit-log-service가 CDK 관리형 audit event queue를 polling합니다.
- `AUDIT_EVENT_QUEUE_URL`은 외부 SQS queue를 사용해야 하는 환경에서만 설정합니다. 비어 있으면 CDK가 생성한 `multi-tenant-{env}-audit-events-queue` URL을 주입합니다.
- outbox-relay-service의 `OUTBOX_PUBLISHER_TYPE=sqs` 기본 대상도 같은 audit event queue입니다. 저장 실패 메시지는 SQS retry 후 `multi-tenant-{env}-audit-events-dlq`로 이동합니다.

Audit DB secret 기준:

- 권장 Secrets Manager 이름은 `multi-tenant-{env}-audit-log-service-database-url`입니다.
- SecretString은 plain PostgreSQL URL 또는 JSON `{ "DATABASE_URL": "postgresql://..." }`, `{ "databaseUrl": "postgresql://..." }`, `{ "url": "postgresql://..." }` 중 하나여야 합니다.
- AWS RDS/Aurora PostgreSQL을 사용할 때는 SSL 요구 설정을 DB 정책에 맞춰 URL query, 예를 들어 `sslmode=require`, 로 명시합니다.
- 1차 운영에서는 migration과 runtime이 같은 secret을 사용할 수 있습니다. 이후 권한 분리가 필요해지면 DDL 권한을 가진 migration 전용 secret과 DML 중심 runtime secret을 분리합니다.
- GitHub Environment secret `AUDIT_DATABASE_URL_SECRET_ARN`에는 secret value가 아니라 Secrets Manager ARN만 저장합니다.

Audit Prisma migration 기준:

- 운영, staging, dev 배포 DB에는 `prisma db push`와 `prisma migrate dev`를 사용하지 않습니다.
- 배포 DB schema 변경은 `pnpm --filter audit-log-service prisma:migrate:deploy`로만 적용합니다.
- `deploy-audit-log-service.yml` 수동 실행 시 `runAuditPrismaMigration=true`를 선택하면 image deploy 전에 `AUDIT_DATABASE_URL_SECRET_ARN`을 읽어 migration을 적용합니다.
- DB가 private subnet에 있어 GitHub-hosted runner에서 접근할 수 없으면 같은 명령을 승인된 self-hosted runner, bastion, 또는 ECS one-off task에서 실행합니다.
- migration 실패 시 ECS deploy를 진행하지 않고 원인을 확인합니다. `prisma migrate resolve`는 DBA/운영자 확인 후 실패 이력 정리에만 사용합니다.

### Optional Outbox Relay context secrets

아래 secret은 outbox-relay-service task definition context로 전달합니다.
GitHub Environment에는 DB URL 원문이 아니라 Secrets Manager ARN만 저장합니다.

| Name | Description |
| --- | --- |
| `AUTH_IAM_OUTBOX_DATABASE_URL_SECRET_ARN` | outbox-relay-service ECS task에 `AUTH_IAM_OUTBOX_DATABASE_URL`로 주입할 Auth/IAM outbox 전용 DB URL secret ARN |
| `TENANT_OUTBOX_DATABASE_URL_SECRET_ARN` | outbox-relay-service ECS task에 `TENANT_OUTBOX_DATABASE_URL`로 주입할 tenant outbox 전용 DB URL secret ARN |
| `WMS_OUTBOX_DATABASE_URL_SECRET_ARN` | outbox-relay-service ECS task에 `WMS_OUTBOX_DATABASE_URL`로 주입할 WMS outbox 전용 DB URL secret ARN |

권장 Secrets Manager 이름은 `multi-tenant-{env}-outbox-relay-auth-iam-database-url`, `multi-tenant-{env}-outbox-relay-tenant-database-url`, `multi-tenant-{env}-outbox-relay-wms-database-url`입니다.
`OUTBOX_WORKER_ENABLED=true`이면 `OUTBOX_SOURCES`에 포함된 source마다 대응하는 secret ARN이 필요합니다.

## tenant-service GitHub Actions 수동 배포

`deploy-tenant-service.yml`도 자동 push 배포 없이 수동 실행(`workflow_dispatch`)만 허용합니다.
이 workflow는 tenant-service를 typecheck/build하고, CDK 기본 인프라를 `tenantDesiredCount=0`으로 먼저 맞춘 뒤 tenant Docker image를 ECR에 push하고 마지막에 `TENANT_DESIRED_COUNT` 값으로 tenant-service만 실행합니다.
같은 CDK 스택을 갱신하므로 gateway-service, auth-iam-service, admin-bff-service, audit-log-service, outbox-relay-service의 desired count와 image tag를 GitHub Environment variable에 반드시 명시해야 합니다.

기본값은 다음과 같습니다.

| Name | Default | Description |
| --- | --- | --- |
| `TENANT_DESIRED_COUNT` | `1` | 최종 tenant-service ECS desired count |
| `GATEWAY_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 gateway-service desired count |
| `AUTH_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 auth-iam-service desired count |
| `AUDIT_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 audit-log-service desired count |
| `OUTBOX_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 outbox-relay-service desired count |
| `GATEWAY_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 gateway-service image tag |
| `AUTH_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 auth-iam-service image tag |
| `ADMIN_BFF_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 admin-bff-service desired count |
| `ADMIN_BFF_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 admin-bff-service image tag |
| `AUDIT_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 audit-log-service image tag |
| `OUTBOX_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 outbox-relay-service image tag |

tenant-service를 실제로 실행하려면 `TENANT_DATABASE_URL_SECRET_ARN`과 `TENANT_INTERNAL_AUTH_SECRET_ARN`이 필요합니다.
workflow는 desired count가 0보다 클 때 필요한 secret이 비어 있으면 Docker push나 CDK deploy 전에 실패하도록 사전 검증합니다.

## admin-bff-service GitHub Actions 수동 배포

`deploy-admin-bff-service.yml`도 자동 push 배포 없이 수동 실행(`workflow_dispatch`)만 허용합니다.
이 workflow는 admin-bff-service를 typecheck/build하고, CDK 기본 인프라를 `adminBffDesiredCount=0`으로 먼저 맞춘 뒤 admin-bff Docker image를 ECR에 push하고 마지막에 `ADMIN_BFF_DESIRED_COUNT` 값으로 admin-bff-service를 실행합니다.
같은 CDK 스택을 갱신하므로 gateway-service, auth-iam-service, tenant-service, audit-log-service, outbox-relay-service의 desired count와 image tag를 GitHub Environment variable에 반드시 명시해야 합니다.

기본값은 다음과 같습니다.

| Name | Default | Description |
| --- | --- | --- |
| `ADMIN_BFF_DESIRED_COUNT` | `1` | 최종 admin-bff-service ECS desired count |
| `GATEWAY_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 gateway-service desired count |
| `AUTH_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 auth-iam-service desired count |
| `TENANT_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 tenant-service desired count |
| `AUDIT_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 audit-log-service desired count |
| `OUTBOX_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 outbox-relay-service desired count |
| `GATEWAY_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 gateway-service image tag |
| `AUTH_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 auth-iam-service image tag |
| `TENANT_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 tenant-service image tag |
| `AUDIT_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 audit-log-service image tag |
| `OUTBOX_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 outbox-relay-service image tag |

admin-bff-service를 실제로 실행하려면 `ADMIN_BFF_AUTH_INTERNAL_AUTH_SECRET_ARN`과 `ADMIN_BFF_TENANT_INTERNAL_AUTH_SECRET_ARN`이 필요합니다.
audit-log-service를 함께 실행하거나 `AUDIT_LOG_SERVICE_URL`을 설정하면 조회용 audit internal auth secret ARN도 필요합니다. Admin BFF 전용 secret은 `ADMIN_BFF_AUDIT_INTERNAL_AUTH_SECRET_ARN`을 우선 사용하고, 없으면 공통 `AUDIT_INTERNAL_AUTH_SECRET_ARN`을 사용합니다.

AWS IAM role은 최소한 CloudFormation/CDK deploy, ECR push, ECS/ALB/VPC/ElastiCache/Logs/Secrets Manager 참조 권한이 필요합니다.

## auth-iam-service 운영 PostgreSQL 기준

`auth-iam-service`는 운영 환경에서 AWS PostgreSQL을 사용합니다. 초기 운영 후보는 RDS PostgreSQL 또는 Aurora PostgreSQL이며, 애플리케이션에는 연결 문자열을 `DATABASE_URL`로 전달합니다.

운영 원칙:

- `DATABASE_URL`은 plain environment 값으로 저장하지 않습니다.
- GitHub Actions secret 또는 ECS task definition 환경 변수에 DB password를 직접 넣지 않습니다.
- Secrets Manager 또는 SSM Parameter Store에 전체 PostgreSQL URL을 저장하고 ECS task secret으로 `DATABASE_URL`에 주입합니다.
- RDS/Aurora security group은 `auth-iam-service` ECS task security group에서 오는 `5432`만 허용합니다.
- production DB는 deletion protection, automated backup, conservative removal policy를 사용합니다.
- Prisma Client generated code는 Docker image build 단계에서 생성하지만, 실제 DB 접속은 runtime secret으로만 수행합니다.

필수 runtime secrets:

| Name | 주입 대상 | 설명 |
| --- | --- | --- |
| `AUTH_DATABASE_URL_ARN` | `DATABASE_URL` | AWS PostgreSQL 연결 문자열 secret ARN |
| `AUTH_JWT_SECRET_ARN` 또는 `AUTH_JWT_PRIVATE_KEY_ARN` | `JWT_SECRET` 또는 `JWT_PRIVATE_KEY` | JWT 서명 secret/key |

필수 runtime variables:

| Name | 예시 | 설명 |
| --- | --- | --- |
| `AUTH_PORT` | `3000` | ECS container port |
| `REDIS_URL` | `redis://{elasticache-endpoint}:6379` | refresh/session/permission cache용 Redis |
| `AUTH_CORS_ALLOWED_ORIGINS` | `https://app.example.com,https://admin.example.com` | prod에서는 비어 있으면 readiness 실패 |

배포 이미지 검증 기준:

```bash
docker build -f apps/auth-iam-service/Dockerfile -t multi-tenant/auth-iam-service:latest .
```

런타임 검증 기준:

```bash
curl http://{auth-iam-service-host}/ready
```

응답의 `checks.database`, `checks.redis`, `checks.security`가 모두 `ok`여야 운영 트래픽을 받을 수 있습니다.

## gateway-service 1차 배포 검증 결과

2026-06-08 기준으로 gateway-service 1차 AWS 배포 검증을 완료했습니다.

- AWS profile: `sssin00-sso`
- AWS account: `252660243277`
- Region: `ap-northeast-2`
- Permission set: `AdministratorAccess`
- Stack: `multi-tenant-dev-gateway-service-stack`
- Image: `gateway-service:latest`
- Health check: `GET /health`
- Result: ALB DNS를 통해 `/health` 정상 응답 확인
- Cleanup: 비용 절감을 위해 테스트 리소스 삭제 완료

## 비용 절감용 정리 명령

테스트 배포 후 비용을 줄이려면 아래 중 하나를 선택합니다.

### ECS task만 중지

ALB, NAT Gateway, ECR, VPC 등 인프라는 남기고 ECS task만 중지합니다.

```bash
pnpm --filter @multi-tenant/infra-cdk exec cdk deploy \
  -c gatewayDesiredCount=0 \
  -c gatewayImageTag=latest
```

### 전체 테스트 인프라 삭제

ALB, NAT Gateway, ECS, ECR, VPC 등 CDK stack이 만든 리소스를 삭제합니다.

```bash
pnpm --filter @multi-tenant/infra-cdk exec cdk destroy
```

삭제 후 확인:

```bash
aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE DELETE_COMPLETE \
  --query 'StackSummaries[?contains(StackName, `multi-tenant-dev-gateway-service-stack`)].{name:StackName,status:StackStatus}' \
  --output table

aws ecs list-clusters --output table

aws ecr describe-repositories \
  --repository-names multi-tenant-dev-gateway-service
```

`cdk destroy` 후에도 직접 만든 리소스나 다른 프로젝트 리소스는 삭제되지 않을 수 있으므로, AWS 콘솔에서 ALB, NAT Gateway, ECR, ECS, CloudWatch Logs를 한 번 더 확인합니다.
