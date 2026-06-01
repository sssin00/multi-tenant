# Multi-Tenant Smart Factory

AWS ECS Fargate 기반 멀티 테넌트 스마트 팩토리 프로젝트입니다.

초기 목표는 WMS를 중심으로 멀티테넌트 플랫폼, 인증/권한, 이벤트 기반 확장 구조를 먼저 구축하는 것입니다.

## Workspace

- `apps/`: 실행 가능한 서비스와 프론트엔드 앱
- `packages/`: 서비스들이 공유하는 공통 패키지
- `infra/cdk/`: AWS CDK 인프라 코드
- `docker/`: 로컬 개발 및 서비스 Docker 설정
- `docs/`: 아키텍처와 개발 문서
- `scripts/`: 개발, 배포, DB, AWS 보조 스크립트
- `tools/`: 생성기, lint, tsconfig 등 개발 도구

## Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm lint
```
