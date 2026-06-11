# Infra

AWS 인프라 코드를 관리합니다.

ECS, RDS, Redis, EventBridge, SQS, S3, IAM, Security Group 등은 CDK로 재현 가능하게 관리합니다.

## gateway-service/auth-iam-service/tenant-service 1차 배포 흐름

현재 CDK는 `gateway-service`, `auth-iam-service`, `tenant-service` 배포를 위한 최소 dev 인프라를 생성합니다.

- ECR repository per service
- VPC public/private subnets
- ECS cluster
- ECS Fargate task definition/service per service
- ALB listener/target group
- Cloud Map private DNS namespace
- ElastiCache Redis for gateway rate limit, auth cache/session, tenant cache dependency
- CloudWatch log group per service
- Security groups

첫 CDK 배포는 ECR repository를 먼저 만들 수 있도록 `gatewayDesiredCount=0`, `authDesiredCount=0`, `tenantDesiredCount=0`을 기본값으로 사용합니다.
이미지를 ECR에 push하고 runtime secret을 준비한 뒤 desired count를 올려 서비스를 실행합니다.
CDK context의 desired count 값은 0 이상의 정수만 허용하며, 잘못된 값은 synth/deploy 전에 실패합니다.

기본 구성은 private subnet + NAT Gateway 배치입니다. dev 계정의 Elastic IP 한도 때문에 NAT Gateway를 만들 수 없을 때는 `-c gatewayUseNatGateway=false`를 붙여 임시로 public subnet에 Fargate task를 배치할 수 있습니다. 이 경우에도 task ingress는 ALB security group에서 오는 `3000` 포트만 허용합니다.

gateway-service rate limit 저장소와 auth-iam-service/tenant-service cache 의존성은 AWS 배포에서 ElastiCache Redis를 사용합니다. CDK는 app subnet에 Redis subnet group을 만들고, gateway-service/auth-iam-service/tenant-service security group에서 Redis `6379` 포트로만 접근하도록 제한합니다. 기본 노드 타입은 `cache.t4g.micro`이며 `-c gatewayRedisNodeType=...`으로 조정할 수 있습니다.

auth-iam-service는 ALB target으로 직접 노출하지 않습니다. gateway-service가 Cloud Map 내부 DNS와 auth base path를 포함한 `http://auth-iam-service.{envName}.multi-tenant.local:3000/api/auth`로 호출하고, 외부 요청은 gateway의 `/api/auth/**` proxy route를 통해 전달합니다.
tenant-service도 ALB target으로 직접 노출하지 않습니다. gateway-service가 Cloud Map 내부 DNS인 `http://tenant-service.{envName}.multi-tenant.local:3000`으로 내부 tenant 상태 API를 호출합니다.

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
Route53을 사용하지 않는 동안에는 사용 중인 DNS 제공자에서 `gatewayDomainName`을 CDK output의 `GatewayDnsTarget` ALB DNS 이름으로 연결합니다.
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

# 4. 이미지와 secret 준비 후 desired count를 올려 재배포
pnpm --filter @multi-tenant/infra-cdk deploy \
  -c gatewayDesiredCount=1 \
  -c authDesiredCount=1 \
  -c tenantDesiredCount=1 \
  -c gatewayUseNatGateway=false \
  -c gatewayImageTag=latest \
  -c authImageTag=latest \
  -c tenantImageTag=latest \
  -c gatewayTenantStatusCheckEnabled=true \
  -c gatewayJwtSecretArn={gateway_jwt_secret_arn} \
  -c authDatabaseUrlSecretArn={auth_database_url_secret_arn} \
  -c authJwtSecretArn={auth_jwt_secret_arn} \
  -c authInternalAuthSecretArn={auth_internal_auth_secret_arn} \
  -c tenantDatabaseUrlSecretArn={tenant_database_url_secret_arn} \
  -c tenantInternalAuthSecretArn={tenant_internal_auth_secret_arn}
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
같은 CDK 스택 안의 auth-iam-service와 tenant-service 리소스 및 task definition context도 함께 갱신되므로, 해당 서비스의 desired count와 image tag는 GitHub Environment variable에 반드시 명시해야 합니다.
Auth/IAM 실행 배포는 `deploy-auth-iam-service.yml`, Tenant 실행 배포는 `deploy-tenant-service.yml`에서 별도로 처리합니다.

### 배포 workflow 요약

세 workflow는 모두 같은 CDK 스택(`multi-tenant-{env}-gateway-service-stack`)을 갱신합니다.
자동 push 배포는 꺼져 있으며, GitHub Actions 화면에서 수동 실행해야 합니다.

| Workflow | Build/push image | 대상 서비스 기본 최종 desired count | 다른 서비스 처리 | 주요 secret guard |
| --- | --- | --- | --- | --- |
| `deploy-gateway-service.yml` | gateway-service | `GATEWAY_DESIRED_COUNT=1` | `AUTH_DESIRED_COUNT`, `AUTH_IMAGE_TAG`, `TENANT_DESIRED_COUNT`, `TENANT_IMAGE_TAG` 명시 필수 | `GATEWAY_JWT_SECRET_ARN` |
| `deploy-auth-iam-service.yml` | auth-iam-service | `AUTH_DESIRED_COUNT=1` | `GATEWAY_DESIRED_COUNT`, `GATEWAY_IMAGE_TAG`, `TENANT_DESIRED_COUNT`, `TENANT_IMAGE_TAG` 명시 필수 | `AUTH_DATABASE_URL_SECRET_ARN`, JWT secret/key, `AUTH_INTERNAL_AUTH_SECRET_ARN` |
| `deploy-tenant-service.yml` | tenant-service | `TENANT_DESIRED_COUNT=1` | `GATEWAY_DESIRED_COUNT`, `GATEWAY_IMAGE_TAG`, `AUTH_DESIRED_COUNT`, `AUTH_IMAGE_TAG` 명시 필수 | `TENANT_DATABASE_URL_SECRET_ARN`, `TENANT_INTERNAL_AUTH_SECRET_ARN` |

중요: 세 workflow 모두 같은 스택을 다시 배포합니다. 비대상 서비스 값이 비어 있으면 workflow가 실패하도록 막아 두었으므로, 처음 인프라만 만들 때도 명시적으로 `0`과 사용할 image tag를 넣어야 합니다.
예를 들어 tenant만 새로 배포하면서 gateway와 auth를 계속 1개씩 유지하려면 `GATEWAY_DESIRED_COUNT=1`, `GATEWAY_IMAGE_TAG={current_gateway_tag}`, `AUTH_DESIRED_COUNT=1`, `AUTH_IMAGE_TAG={current_auth_tag}`를 함께 설정합니다. 해당 서비스 desired count가 0보다 크면 그 서비스의 runtime secret ARN도 같이 설정해야 합니다.

| Branch | GitHub Environment | APP_ENV/CDK envName |
| --- | --- | --- |
| `dev` | `dev` | `dev` |
| `staging` | `staging` | `staging` |
| `main` | `prod` | `prod` |

워크플로는 다음 순서로 실행합니다.

1. `gateway-service` typecheck/build
2. CDK typecheck
3. CDK deploy with target `gatewayDesiredCount=0`, and explicitly provided auth/tenant desired counts
4. ECR repository URI 조회
5. gateway-service Docker image build/push
6. CDK deploy with target gateway desired count, and explicitly provided auth/tenant desired counts

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
| `AUTH_IAM_SERVICE_URL` | Cloud Map 내부 DNS + `/api/auth` | Auth/IAM upstream URL override. auth-iam-service 컨트롤러 경로와 맞추기 위해 `/api/auth` base path까지 포함합니다. |
| `ADMIN_BFF_SERVICE_URL` | `http://admin-bff-service:3000` | Admin BFF upstream URL |
| `USER_BFF_SERVICE_URL` | `http://user-bff-service:3000` | User BFF upstream URL |
| `TENANT_SERVICE_URL` | `http://tenant-service:3000` | Tenant service upstream URL |

### Optional Auth/IAM context secrets

아래 secret은 gateway workflow에서도 CDK task definition context로 전달할 수 있습니다. gateway workflow에서 `AUTH_DESIRED_COUNT`를 0보다 크게 유지하려면 Auth/IAM runtime secret ARN도 함께 필요합니다.

| Name | Description |
| --- | --- |
| `AUTH_DATABASE_URL_SECRET_ARN` | Auth/IAM ECS task에 `DATABASE_URL`로 주입할 Secrets Manager secret ARN |
| `AUTH_JWT_SECRET_ARN` | HS256 JWT secret ARN |
| `AUTH_JWT_PRIVATE_KEY_SECRET_ARN` | RS256 private key secret ARN |
| `AUTH_JWT_PUBLIC_KEY_SECRET_ARN` | RS256 public key secret ARN |
| `AUTH_INTERNAL_AUTH_SECRET_ARN` | 내부 서비스 호출 인증용 secret ARN |

## auth-iam-service GitHub Actions 수동 배포

`deploy-auth-iam-service.yml`도 자동 push 배포 없이 수동 실행(`workflow_dispatch`)만 허용합니다.
이 workflow는 auth-iam-service를 typecheck/build하고, CDK 기본 인프라를 `authDesiredCount=0`으로 먼저 맞춘 뒤 auth Docker image를 ECR에 push하고 마지막에 `AUTH_DESIRED_COUNT` 값으로 auth-iam-service를 실행합니다.
같은 CDK 스택을 갱신하므로 gateway-service와 tenant-service의 desired count와 image tag를 GitHub Environment variable에 반드시 명시해야 합니다.

기본값은 다음과 같습니다.

| Name | Default | Description |
| --- | --- | --- |
| `AUTH_DESIRED_COUNT` | `1` | 최종 auth-iam-service ECS desired count |
| `AUTH_JWT_ALGORITHM` | `HS256` | Auth/IAM access token 서명 알고리즘 |
| `GATEWAY_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 gateway-service desired count |
| `TENANT_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 tenant-service desired count |
| `GATEWAY_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 gateway-service image tag |
| `TENANT_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 tenant-service image tag |
| `GATEWAY_TENANT_STATUS_CHECK_ENABLED` | `false` | gateway가 tenant-service 상태 API를 호출할지 여부 |

auth-iam-service를 실제로 실행하려면 `AUTH_DATABASE_URL_SECRET_ARN`, `AUTH_INTERNAL_AUTH_SECRET_ARN`, 그리고 JWT 알고리즘에 맞는 secret이 필요합니다.
`HS256`은 `AUTH_JWT_SECRET_ARN`, `RS256`은 `AUTH_JWT_PRIVATE_KEY_SECRET_ARN`과 `AUTH_JWT_PUBLIC_KEY_SECRET_ARN`을 사용합니다.
workflow는 desired count가 0보다 클 때 필요한 secret이 비어 있으면 Docker push나 CDK deploy 전에 실패하도록 사전 검증합니다.

### Optional Tenant context secrets

아래 secret은 gateway/auth workflow에서도 CDK task definition context로 전달할 수 있습니다. 해당 workflow에서 `TENANT_DESIRED_COUNT`를 0보다 크게 유지하려면 Tenant runtime secret ARN도 함께 필요합니다.

| Name | Description |
| --- | --- |
| `TENANT_DATABASE_URL_SECRET_ARN` | Tenant ECS task에 `DATABASE_URL`로 주입할 Secrets Manager secret ARN |
| `TENANT_INTERNAL_AUTH_SECRET_ARN` | gateway-service와 tenant-service가 공유할 내부 호출 인증 secret ARN |

## tenant-service GitHub Actions 수동 배포

`deploy-tenant-service.yml`도 자동 push 배포 없이 수동 실행(`workflow_dispatch`)만 허용합니다.
이 workflow는 tenant-service를 typecheck/build하고, CDK 기본 인프라를 `tenantDesiredCount=0`으로 먼저 맞춘 뒤 tenant Docker image를 ECR에 push하고 마지막에 `TENANT_DESIRED_COUNT` 값으로 tenant-service만 실행합니다.
같은 CDK 스택을 갱신하므로 gateway-service와 auth-iam-service의 desired count와 image tag를 GitHub Environment variable에 반드시 명시해야 합니다.

기본값은 다음과 같습니다.

| Name | Default | Description |
| --- | --- | --- |
| `TENANT_DESIRED_COUNT` | `1` | 최종 tenant-service ECS desired count |
| `GATEWAY_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 gateway-service desired count |
| `AUTH_DESIRED_COUNT` | required | 같은 스택 업데이트 중 보존할 auth-iam-service desired count |
| `GATEWAY_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 gateway-service image tag |
| `AUTH_IMAGE_TAG` | required | 같은 스택 업데이트 중 보존할 auth-iam-service image tag |
| `GATEWAY_TENANT_STATUS_CHECK_ENABLED` | `false` | gateway가 tenant-service 상태 API를 호출할지 여부 |

tenant-service를 실제로 실행하려면 `TENANT_DATABASE_URL_SECRET_ARN`과 `TENANT_INTERNAL_AUTH_SECRET_ARN`이 필요합니다.
gateway tenant status check를 켤 때는 같은 `TENANT_INTERNAL_AUTH_SECRET_ARN`이 gateway-service에도 `TENANT_INTERNAL_AUTH_SECRET`으로 주입됩니다.
workflow는 desired count가 0보다 클 때 필요한 secret이 비어 있으면 Docker push나 CDK deploy 전에 실패하도록 사전 검증합니다.

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
