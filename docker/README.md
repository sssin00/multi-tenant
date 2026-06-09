# Docker

로컬 개발 환경, 배포용 compose 템플릿, 서비스별 Dockerfile을 관리합니다.

## gateway-service 로컬 실행

Docker Compose 프로젝트 이름은 `gateway-service-local`로 고정합니다. Docker Desktop이나 `docker compose ls`에서 로컬 개발 스택이 이 이름으로 표시됩니다.

빌드하면서 실행:

```bash
docker compose -f docker/local/docker-compose.yml up --build gateway-service
```

백그라운드 실행:

```bash
docker compose -f docker/local/docker-compose.yml up --build -d gateway-service
```

Health check:

```bash
curl http://localhost:3000/health
```

로그 확인:

```bash
docker compose -f docker/local/docker-compose.yml logs -f gateway-service
```

중지:

```bash
docker compose -f docker/local/docker-compose.yml down
```

이미지만 빌드:

```bash
docker compose -f docker/local/docker-compose.yml build gateway-service
```

Compose 설정 확인:

```bash
docker compose -f docker/local/docker-compose.yml config
```

NestJS 서비스 이미지는 `docker/services/Dockerfile.nest`를 공통으로 사용하고, `APP_NAME` build arg로 실행할 앱을 지정합니다.

## gateway-service 배포용 실행

배포용 compose는 이미 빌드/푸시된 이미지를 실행합니다. 환경은 아래 파일 중 하나를 선택합니다.

- `docker/env/gateway-service/.env.dev`
- `docker/env/gateway-service/.env.staging`
- `docker/env/gateway-service/.env.prod`

dev 환경 설정 확인:

```bash
docker compose --env-file docker/env/gateway-service/.env.dev -f docker/deploy/docker-compose.yml config
```

dev 환경 백그라운드 실행:

```bash
docker compose --env-file docker/env/gateway-service/.env.dev -f docker/deploy/docker-compose.yml up -d
```

Health check:

```bash
curl http://localhost:3000/health
```

로그 확인:

```bash
docker compose --env-file docker/env/gateway-service/.env.dev -f docker/deploy/docker-compose.yml logs -f gateway-service
```

중지:

```bash
docker compose --env-file docker/env/gateway-service/.env.dev -f docker/deploy/docker-compose.yml down
```

이미지 교체 후 재배포:

```bash
docker compose --env-file docker/env/gateway-service/.env.dev -f docker/deploy/docker-compose.yml pull gateway-service
docker compose --env-file docker/env/gateway-service/.env.dev -f docker/deploy/docker-compose.yml up -d gateway-service
```

AWS ECS 배포는 compose가 아니라 `infra/cdk`에서 관리합니다. `docker/deploy/docker-compose.yml`은 단독 서버나 VM에서 컨테이너를 실행하기 위한 템플릿입니다.
로컬 compose와 동시에 검증할 때는 `GATEWAY_CONTAINER_NAME`과 `GATEWAY_HOST_PORT`를 바꿔 충돌을 피합니다.
