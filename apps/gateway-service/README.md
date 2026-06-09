# gateway-service

ALB 뒤에서 인증 확인, 테넌트 식별, 라우팅, rate limit을 담당합니다.

## Docker 실행

로컬 개발용 compose:

Docker Compose 프로젝트 이름은 `gateway-service-local`입니다.

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

배포용 compose:

```bash
docker compose --env-file docker/env/gateway-service/.env.dev -f docker/deploy/docker-compose.yml up -d
```

배포용 로그 확인:

```bash
docker compose --env-file docker/env/gateway-service/.env.dev -f docker/deploy/docker-compose.yml logs -f gateway-service
```
