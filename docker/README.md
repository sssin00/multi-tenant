# Docker

로컬 개발 환경, 배포용 compose 템플릿, 서비스별 Dockerfile을 관리합니다.

## 로컬 실행

Docker Compose 프로젝트 이름은 `multi-tenant-local`로 고정합니다. Docker Desktop이나 `docker compose ls`에서 로컬 개발 스택이 이 이름으로 표시됩니다.

현재 로컬 compose는 구현이 완료된 `auth-iam-service`, `gateway-service`와 공용 의존성인 PostgreSQL, Redis, LocalStack을 실행합니다. `auth-iam-db-push`는 PostgreSQL 준비 후 Prisma schema를 로컬 DB에 반영하고 종료되는 초기화 작업입니다.

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
curl http://localhost:3000/ready
curl http://localhost:3001/ready
```

로그 확인:

```bash
docker compose -f docker/local/docker-compose.yml logs -f gateway-service auth-iam-service
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

## 배포용 실행

배포용 compose는 이미 빌드/푸시된 `auth-iam-service`, `gateway-service` 이미지를 실행합니다. 환경별 값은 서비스별 `docker/env/{service}/.env.local`, `.env.dev`, `.env.staging`, `.env.prod` 중 하나를 사용합니다. 운영 secret은 저장소에 커밋하지 않습니다.

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
```

로그 확인:

```bash
COMPOSE_ENV=dev docker compose -f docker/deploy/docker-compose.yml logs -f gateway-service auth-iam-service
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
