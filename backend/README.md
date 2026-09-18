# Backend

Project Health의 NestJS API 서버입니다. `frontend/`와 별도로 의존성을 설치하고 실행합니다.

## 개발 환경

- Node.js 24 LTS (24.15 이상, `.nvmrc` 제공)
- npm 및 `package-lock.json`으로 의존성 관리
- NestJS 12, Express, TypeScript strict 모드, ESM
- Oxlint, Prettier, Vitest, Supertest

NestJS 12의 [공식 초기 설정](https://docs.nestjs.com/first-steps)을 기준으로 구성했습니다.

## 시작하기

저장소 루트에서 실행합니다.

```bash
cd backend
nvm use # nvm을 사용하는 경우. 해당 버전이 없으면 nvm install 실행
npm ci
cp .env.example .env
npm run start:dev
```

기본 주소는 `http://localhost:3001/api`이며, 파일을 수정하면 서버가 자동으로 다시 시작됩니다.

```bash
curl http://localhost:3001/api/health
# {"status":"ok"}
```

상태 확인 API는 서버의 응답 여부만 확인합니다. DB 등 외부 서비스의 상태 검사는 아직 포함하지 않습니다.

## 환경변수

`backend/.env`를 자동으로 읽습니다. 시스템에 설정된 환경변수가 파일보다 우선하며, `.env`가 없어도 아래 기본값으로 실행됩니다. 잘못된 값은 서버 시작 시 오류로 처리됩니다.

| 변수              | 기본값                  | 용도                                                   |
| ----------------- | ----------------------- | ------------------------------------------------------ |
| `NODE_ENV`        | `development`           | `development`, `production`, `test` 중 선택            |
| `PORT`            | `3001`                  | API 서버 포트 (1–65535)                                |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | 브라우저 CORS 허용 origin. 경로와 마지막 `/` 없이 입력 |

환경변수 처리는 NestJS의 [ConfigModule](https://docs.nestjs.com/techniques/configuration)을 사용합니다. `.env` 파일은 Git에서 제외하고, 필요한 항목은 `.env.example`에 기록합니다. CORS 설정은 인증을 대신하지 않습니다.

## 명령어

아래 명령어는 모두 `backend/`에서 실행합니다.

| 명령어                 | 설명                                                       |
| ---------------------- | ---------------------------------------------------------- |
| `npm run start:dev`    | 변경 감지 개발 서버                                        |
| `npm run start:debug`  | 디버거를 연결할 수 있는 개발 서버                          |
| `npm run build`        | `dist/`로 빌드                                             |
| `npm run start:prod`   | 빌드한 서버 실행. 실행 환경에서 `NODE_ENV=production` 설정 |
| `npm run lint`         | 타입 정보를 활용한 코드 검사                               |
| `npm run typecheck`    | 소스 및 테스트 TypeScript 타입 검사                        |
| `npm run format`       | 소스, 설정, 문서 서식 정리                                 |
| `npm run format:check` | 서식 검사                                                  |
| `npm test`             | 단위 테스트                                                |
| `npm run test:watch`   | 테스트 변경 감지                                           |
| `npm run test:cov`     | 단위 테스트 커버리지                                       |
| `npm run test:e2e`     | API 경로와 CORS 통합 테스트                                |
| `npm run check`        | 서식·린트·타입·단위/통합 테스트·빌드 전체 검사             |

## 디렉토리 구조

```text
backend/
├── src/
│   ├── main.ts                 # 서버 실행 및 종료 처리
│   ├── app.module.ts           # 루트 모듈
│   ├── setup-app.ts            # 공통 API prefix와 CORS 설정
│   ├── config/                # 환경변수 검증
│   └── health/                # GET /api/health
├── test/                      # API 통합 테스트
├── .env.example
├── nest-cli.json
├── package.json
└── tsconfig.json
```

## 서버 실행 흐름

1. `src/main.ts`에서 `NestFactory.create(AppModule)`로 애플리케이션을 생성합니다.
2. `AppModule`이 환경변수 설정과 `HealthModule`을 불러옵니다. `ConfigModule`은 `.env`를 읽고 `config/environment.ts`의 검증 함수를 실행합니다.
3. `setup-app.ts`에서 모든 API에 `/api` 접두사를 적용하고 `FRONTEND_ORIGIN`에 맞춰 CORS를 설정합니다.
4. `main.ts`에서 종료 시 정리 작업을 위한 훅을 활성화하고, `PORT`에 지정한 포트로 서버를 실행합니다.

예를 들어 `GET /api/health` 요청은 `HealthController`의 `getHealth()` 메서드에서 처리하며, 반환한 객체는 JSON 응답이 됩니다.

## 기능 추가 방법

새 기능은 `src/` 아래에 기능별 디렉토리로 추가합니다. 각 구성 요소의 역할은 다음과 같습니다.

| 구성 요소  | 역할                                              | 회원 기능 예시        |
| ---------- | ------------------------------------------------- | --------------------- |
| Module     | 관련 컨트롤러와 서비스를 묶고 다른 모듈에 연결    | `users.module.ts`     |
| Controller | URL과 HTTP 메서드를 정의하고 요청을 서비스로 전달 | `users.controller.ts` |
| Service    | 조회·저장 등 비즈니스 로직 처리                   | `users.service.ts`    |

`backend/`에서 Nest CLI로 기본 파일을 만들 수 있습니다.

```bash
npx nest generate module users
npx nest generate controller users
npx nest generate service users
```

생성한 기능 모듈은 `AppModule`의 `imports`에, 컨트롤러와 서비스는 해당 기능 모듈의 `controllers`와 `providers`에 등록되는지 확인합니다.

ESM을 사용하므로 로컬 TypeScript 파일을 import할 때도 빌드 결과 기준으로 경로 끝에 `.js`를 붙입니다.

```typescript
import { UsersService } from './users.service.js';
```

## 코드 검사와 테스트

- **Oxlint**: 타입 정보를 활용해 코드의 잠재적인 오류를 검사합니다. 경고도 검사 실패로 처리합니다.
- **Prettier**: 코드와 문서의 서식을 통일합니다.
- **TypeScript**: `strict` 모드로 소스와 테스트의 타입을 검사합니다.
- **Vitest**: 단위 테스트와 통합 테스트를 실행합니다.
- **Supertest**: Nest 애플리케이션에 HTTP 요청을 보내 응답을 검증합니다.

현재 테스트 범위는 다음과 같습니다.

| 파일                             | 검증 내용                                                          |
| -------------------------------- | ------------------------------------------------------------------ |
| `src/config/environment.spec.ts` | 환경변수 기본값, 포트 숫자 변환, 잘못된 포트·origin·실행 환경 거부 |
| `test/app.e2e-spec.ts`           | `/api/health` 응답, `/api` 접두사 적용, 프런트엔드 CORS 사전 요청  |

변경 후에는 `npm run check`로 서식, 린트, 타입, 단위·통합 테스트와 빌드를 한 번에 확인합니다. 통합 테스트는 임시 로컬 포트를 사용하므로 포트 열기가 허용된 환경에서 실행해야 합니다.
