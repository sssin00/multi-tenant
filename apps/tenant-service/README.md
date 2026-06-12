# tenant-service

테넌트 생성, 상태, 도메인, 사용 모듈, DB 라우팅 전략을 관리합니다.

## Tenant Identity

`tenantId`는 시스템 내부 불변 식별자이며 UUID로 생성합니다. 회사명, 사업자번호, domain, 사람이 읽는 code를 `tenantId`로 사용하지 않습니다.

운영자와 화면에서 읽기 쉬운 식별자는 별도 unique `tenant.code`로 관리합니다. JWT, `X-Tenant-Id`, tenant-scoped DB 접근 조건에는 `tenantId`를 사용합니다.

`tenant.code`는 tenant 생성 시 tenant 정보에서 자동 생성합니다. 형식은 대문자 base 4자리와 sequence 4자리를 붙인 8자리입니다. `domain`이 있으면 등록 도메인의 이름 label을 우선 사용하고, 없으면 tenant name을 대문자 ASCII로 정규화합니다. 예를 들어 `acme.example.com`은 `EXAM0001`, `factory.acme.co.kr`은 `ACME0001`을 기본 code 후보로 사용합니다. ASCII label이 없고 한글이 있으면 첫 한글 음절을 로마자로 변환해 base로 사용하며, 4자리가 모자라면 hash로 채웁니다. 예: `한국공장`은 `HANF0001`. 한글도 없으면 SHA-256 hash의 가운데 4글자를 base로 사용합니다. 충돌 시 `0002`, `0003`처럼 4자리 sequence를 증가시킵니다.

## Internal admin API

Admin BFF는 HMAC internal auth로 tenant-service의 내부 관리 API를 호출합니다.

- `GET /internal/admin/tenants`: tenant 목록, domain 요약, 활성 module 요약 조회
- `POST /internal/admin/tenants`: tenant 생성과 `tenant.code` 자동 생성
- `GET /internal/admin/tenants/{tenantId}`: tenant 상세, domain, 활성 module, settings 조회
- `PATCH /internal/admin/tenants/{tenantId}`: tenant 기본 정보 수정
- `PATCH /internal/admin/tenants/{tenantId}/status`: tenant 상태 변경과 `tenant.status.changed` outbox event 저장
- `PUT /internal/admin/tenants/{tenantId}/modules`: tenant 활성 module 교체와 module 변경 outbox event 저장
- `GET /internal/admin/tenants/{tenantId}/domains`: tenant domain 목록 조회
- `POST /internal/admin/tenants/{tenantId}/domains`: tenant domain 추가
- `DELETE /internal/admin/tenants/{tenantId}/domains/{domainId}`: tenant domain 비활성화

## Database

서비스 저장소는 서비스별 database로 분리합니다. 로컬 Docker 기준 tenant-service는 `tenant` database를 사용하며, 다른 서비스의 내부 테이블을 직접 조회하거나 공유하지 않습니다.

테넌트별 저장 전략의 Shared DB + `tenantId` 원칙은 tenant-service database 내부에서 여러 tenant 데이터를 구분하는 기준입니다. 서비스 간 database 공유를 의미하지 않습니다.
