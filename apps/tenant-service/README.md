# tenant-service

테넌트 생성, 상태, 도메인, 사용 모듈, DB 라우팅 전략을 관리합니다.

## Tenant Identity

`tenantId`는 시스템 내부 불변 식별자이며 UUID로 생성합니다. 회사명, 사업자번호, domain, 사람이 읽는 code를 `tenantId`로 사용하지 않습니다.

운영자와 화면에서 읽기 쉬운 식별자는 별도 unique `tenant.code`로 관리합니다. JWT, `X-Tenant-Id`, tenant-scoped DB 접근 조건에는 `tenantId`를 사용합니다.

`tenant.code`는 tenant 생성 시 tenant 정보에서 자동 생성합니다. 형식은 대문자 base 4자리와 sequence 4자리를 붙인 8자리입니다. `domain`이 있으면 등록 도메인의 이름 label을 우선 사용하고, 없으면 tenant name을 대문자 ASCII로 정규화합니다. 예를 들어 `acme.example.com`은 `EXAM0001`, `factory.acme.co.kr`은 `ACME0001`을 기본 code 후보로 사용합니다. ASCII label이 없고 한글이 있으면 첫 한글 음절을 로마자로 변환해 base로 사용하며, 4자리가 모자라면 hash로 채웁니다. 예: `한국공장`은 `HANF0001`. 한글도 없으면 SHA-256 hash의 가운데 4글자를 base로 사용합니다. 충돌 시 `0002`, `0003`처럼 4자리 sequence를 증가시킵니다.

## Database

서비스 저장소는 서비스별 database로 분리합니다. 로컬 Docker 기준 tenant-service는 `tenant` database를 사용하며, 다른 서비스의 내부 테이블을 직접 조회하거나 공유하지 않습니다.

테넌트별 저장 전략의 Shared DB + `tenantId` 원칙은 tenant-service database 내부에서 여러 tenant 데이터를 구분하는 기준입니다. 서비스 간 database 공유를 의미하지 않습니다.
