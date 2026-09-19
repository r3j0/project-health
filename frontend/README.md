# 모두채력 프론트엔드

모바일 중심의 국민체력100 측정 기록 웹앱입니다. 이메일 가입·로그인·로그아웃, 내 계정 조회, 본인 측정 기록의 생성·목록·상세·수정·삭제를 실제 백엔드에 연결합니다. 로그인 후 시작 화면은 `/measurements`입니다.

승인된 시안의 색상·서체·2단계 입력 흐름을 적용했습니다. 캐릭터는 `components/ui.tsx`의 `ArtworkSlot`으로 위치만 잡고, 로고는 임시 서비스명을 텍스트로 표시합니다. 실제 이미지 확정 시 이 자리를 교체하면 됩니다. 운동 추천·그룹·코인·캐릭터 성장·OCR·등급 자동 계산은 후속 범위입니다.

## 로컬 실행

프론트와 백엔드 모두 Node.js 24.15 이상인 24 LTS 사용을 권장합니다. PostgreSQL과 인증·측정 API가 포함된 백엔드가 먼저 실행되어야 합니다.

백엔드 변경이 아직 현재 브랜치에 합쳐지지 않았다면 저장소 루트에서 별도 체크아웃으로 실행할 수 있습니다. 해당 경로가 이미 있다면 새로 만들지 말고 기존 체크아웃을 사용합니다.

```bash
git fetch origin
git worktree add --detach ../project-health-backend origin/feat/backend/db-init
cd ../project-health-backend/backend
npm ci
cp .env.example .env
npm run db:local:start
npm run auth:secret
npm run db:migrate:deploy
npm run start:dev
```

로컬 PostgreSQL 실행 전 해당 백엔드의 README에 안내된 PostgreSQL 설치 조건을 확인하세요. 백엔드의 `FRONTEND_ORIGIN`은 `http://localhost:3000`으로 설정합니다. 기존 `.env`가 있으면 복사로 덮어쓰지 않습니다. 운영 데이터베이스를 로컬 검증에 사용하지 않습니다.

다른 터미널에서 이 저장소의 `frontend/`로 이동합니다.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

[http://localhost:3000](http://localhost:3000)에서 직접 계정을 만들고 기록을 등록할 수 있습니다. 예시 계정이나 측정값을 자동 생성하지 않습니다.

- `BACKEND_API_URL`: Next.js 서버가 연결할 백엔드 주소. 기본값 `http://127.0.0.1:3001`이며 `/api/v1`은 붙이지 않습니다.
- 브라우저 요청은 같은 출처의 `/api/v1`을 사용하고 Next.js rewrite가 백엔드로 전달합니다. 토큰·개인정보를 캐시하지 않습니다.
- 브라우저 주소의 `localhost`와 `127.0.0.1`은 서로 다른 출처입니다. 프론트 주소를 바꾸면 백엔드 `FRONTEND_ORIGIN`도 맞춰야 합니다.
- rewrite 주소는 빌드 시 반영됩니다. 운영 빌드에서 `BACKEND_API_URL` 변경 시 다시 빌드합니다.
- 배포 시 HTTPS와 백엔드의 운영용 보안 쿠키 설정을 사용합니다. 자동 로그인 유지는 Web Locks 지원 브라우저의 HTTPS 또는 localhost 환경을 전제로 합니다. 지원하지 않는 환경에서는 새로고침 후 다시 로그인합니다.

```bash
npm run build
npm run start
```

## API 연동 규칙

- Access token은 메모리에서만 보관하고 Refresh token은 서버의 HttpOnly 쿠키로만 사용합니다. 인증 POST에 CSRF 헤더를 보냅니다.
- 초기 접속·새로고침과 API의 인증 만료 응답에서 세션을 갱신합니다. Web Locks로 탭 간 인증 요청을 직렬화하고 BroadcastChannel로 로그인·로그아웃을 공유합니다.
- 검사명·단위·연령·수치 제한은 서버 카탈로그를 사용합니다. 수정 시 해당 기록에 저장된 카탈로그 버전을 사용합니다.
- 측정값은 숫자로 변환하지 않고 Decimal 문자열로 전송합니다. 공란은 제외하며 실제 `0`과 음수·소수 정밀도를 보존합니다. 등급은 사용자가 입력한 결과표 원문입니다.
- 생성은 요청 본문에 대응하는 `Idempotency-Key`를 유지합니다. 저장 결과를 알 수 없는 통신 오류가 나면 입력을 잠그고 같은 키·내용으로 재확인합니다. 해당 재시도 정보는 화면 메모리에만 있으며 페이지를 닫거나 새로고침하면 유지되지 않습니다. 이 경우 목록에서 저장 여부를 확인한 뒤 재등록합니다.
- 수정·삭제는 상세 조회에서 받은 `ETag`를 `If-Match`로 전달합니다. PATCH의 `items`는 전체 목록입니다. 충돌 시 작성 중인 값을 보존하고 최신 기록을 확인하며, 명시적으로 선택하기 전에는 덮어쓰지 않습니다.
- 오류는 실패 상태와 재시도를 표시합니다. API 실패를 예시 데이터나 임의의 성공으로 대체하지 않습니다.
- 미저장 변경은 앱의 링크 이동과 문서 새로고침·닫기에서 이탈 확인을 제공합니다. 브라우저 뒤로가기·앞으로가기를 포함한 임시 저장 및 복구는 현재 제공하지 않습니다.

## 검증

```bash
npm run check
npm run format:check
```

`check`는 린트·타입 검사·입력 검증 단위 테스트·프로덕션 빌드를 실행합니다. E2E는 별도 실행입니다.

실제 PostgreSQL을 사용하는 **개발/테스트용 백엔드**와 프론트를 실행한 상태에서:

```bash
npx playwright install chromium
npm run test:e2e
```

기본 프론트 주소는 `http://localhost:3000`이고 `E2E_BASE_URL`로 바꿀 수 있습니다. 테스트는 실행마다 `frontend-e2e-<uuid>@example.test` 계정과 측정 데이터를 만듭니다. 테스트 계정 삭제 API가 없어 데이터가 남으므로 전용 로컬 DB에서만 실행하세요. 오류 응답·응답 유실 시나리오 외에는 실제 API를 사용합니다. 인증 요청의 횟수 제한은 해제하지 않으므로 연속 실행 시 제한 시간이 지난 후 다시 실행합니다.

가입·재로그인·갱신·로그아웃, 본인 접근 제한, 부분 저장·긴 소수·0·음수, 선택 정보 보존, 생성 응답 유실 재시도, 탭 간 수정/삭제 충돌과 동시 갱신, 연령 검증, 기간 필터, 카탈로그 장애 복구 및 모바일 너비를 검증합니다. Chromium의 모바일 뷰포트에서 확인하며 실제 iOS/Android 키보드 검증을 대체하지는 않습니다. 스크린샷과 실패 추적은 Git에서 제외된 `test-results/`, HTML 결과는 `playwright-report/`에 생성됩니다.

## 파일 구성

- `app/`: 화면 경로·공통 스타일·레이아웃.
- `components/`: 인증 폼, 계정, 기록 목록·입력·상세, 항목 선택창과 공통 UI.
- `lib/session.ts`, `lib/http.ts`: 인증 상태·쿠키 갱신·요청·오류 처리.
- `lib/measurement-form.ts`: 입력 검증과 정밀도를 유지하는 요청 구성.
- `lib/measurements.ts`, `lib/types.ts`: 측정 API·날짜 표시·응답 타입.
- `tests/unit/`, `tests/e2e/`: 입력 검증 단위 테스트와 실제 백엔드 연동 흐름 검증.

2026-09-19 연동 기준: 백엔드 `feat/backend/db-init`의 `3dc288899b243d2983a51aa30740557c0a51db04`. 백엔드의 `docs/auth-api.md`, `docs/measurements-api.md`, `docs/api-versioning.md`를 계약으로 사용합니다. 기존 백엔드 리뷰에서 보고한 DB 시작 시 준비 상태 검사와 동시 조회 일관성 문제는 백엔드 측 후속 수정 대상입니다.
