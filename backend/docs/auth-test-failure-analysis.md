# 인증 통합 테스트의 간헐적 404 분석

확인일: 2026-09-23. 환경: macOS (`darwin`), Node.js v26.7.0, Supertest 7.2.2, Superagent 10.3.0, NestJS 12.0.3.

## 결론

Supertest가 테스트 HTTP 서버를 주소 지정 없이 `listen(0)`으로 열고 클라이언트는 `127.0.0.1`로 접속하는 조합에 문제가 있었다. macOS에서는 IPv6 wildcard `[::]:port`와 다른 서버의 IPv4 `127.0.0.1:port` 바인딩이 함께 성공할 수 있다. 그 포트로 보낸 IPv4 요청은 더 구체적인 loopback 서버에 도달할 수 있어, 테스트 대상 앱의 응답 대신 다른 서버의 404·401 등을 받는다.

이 환경에서 **실제 Supertest 자동 포트 배정으로 다른 서버의 404를 받는 현상**을 재현했다. 인증 알고리즘·평가 기능의 오류로 단정할 근거는 없다. 최초 실패에는 응답 본문·포트·서버 식별자가 없으므로 당시 응답한 특정 프로세스까지 사후 확인한 것은 아니다. 확인한 결함은 이 오접속을 허용하는 테스트 리스너 바인딩이며, 이를 제거했다.

동일한 동작이 [Supertest 공식 저장소 이슈 #894](https://github.com/forwardemail/supertest/issues/894)에 보고되어 있다. 외부 사례만으로 결론을 내리지 않고 아래 로컬 재현으로 검증했다.

## 조사와 재현 증거

최초 관측은 `test/auth.e2e-spec.ts`의 HS384 토큰 요청에서 예상 401 대신 404였다. 코드 조사에서는 다음을 확인했다.

- `TokenService.verify()`는 HS256만 허용하고 모든 검증 오류를 `UnauthorizedException`으로 바꾼다.
- Nest는 해당 예외를 401로 직렬화한다. `/auth/me` 처리 경로에 404를 반환하는 코드가 없다.
- 잘못된 JWT만 3,000회 요청한 경우 전부 401이었다.
- 원래 인증 테스트 흐름을 반복하자 로그인 성공 기대 요청의 401, 동시 갱신 요청 두 건의 404도 관측됐다. 특정 JWT 알고리즘에 국한된 현상이 아니었다.
- HTTP E2E는 `app.init()`까지만 호출하여 실제 listen/close를 Supertest의 요청별 자동 동작에 맡기고 있었다.

첫 통제 실험에서는 직접 만든 `127.0.0.1:63204` 서버와 `[::]:63204` 테스트 서버가 함께 listen하는 것을 확인했다. Supertest 요청은 전자의 404를 받았고 의도한 서버의 요청 수는 0이었다. 명시적 IPv4 서버로 바꾸면 다른 포트를 배정받아 예상 401을 반환했다.

이어 **포트를 강제로 지정하지 않는 실제 `request(server)` → 자동 `listen(0)` 경로**로 검증했다. 임시로 직접 만든 loopback 리스너들만 사용했고 모두 종료했다.

```json
{
  "requestUrl": "http://127.0.0.1:52252/api/v1/auth/me",
  "testServerAddress": { "address": "::", "family": "IPv6", "port": 52252 },
  "responseStatus": 404,
  "responseMarker": "controlled-foreign-server",
  "reachedIntendedServer": false
}
```

같은 조건에서 명시적 IPv4 바인딩 결과:

```json
{
  "testServerAddress": {
    "address": "127.0.0.1",
    "family": "IPv4",
    "port": 52373
  },
  "responseStatus": 401,
  "responseMarker": "fixed-explicit-loopback"
}
```

포트 번호는 재현 당시 값이며 고정 설정으로 사용하지 않는다. 진단에는 운영 계정·토큰·비밀번호를 사용하지 않았다. 임시 반복 테스트와 재현 출력은 Git 제외 경로 `.local/auth-investigation/`에 남겼고 정규 테스트 목록에서는 제거했다.

## 수정

HTTP E2E의 7개 파일, 9개 정상 앱 초기화를 다음처럼 바꿨다.

```ts
await app.listen(0, '127.0.0.1');
```

`listen()`은 Nest 초기화를 기다리고, OS가 그 주소에서 사용 가능한 임시 포트를 선택한다. Supertest는 이미 열려 있는 서버를 사용하므로 요청마다 wildcard 서버를 다시 열지 않는다. 기존 `app.close()`로 테스트 종료 시 닫는다.

적용 파일: `account-update.e2e-spec.ts`, `app.e2e-spec.ts`, `auth.e2e-spec.ts`, `measurement-evaluation.e2e-spec.ts`, `measurement-extraction.e2e-spec.ts`, `measurements.e2e-spec.ts`, `users.e2e-spec.ts`.

DB 연결 실패 자체를 검증하는 `unavailableApp.init()`는 유지했다. 인증 구현·JWT 허용 알고리즘·HTTP 기대 상태·운영 서버 설정은 변경하지 않았다. `app.e2e-spec.ts`의 기존 health 테스트에서 실제 listener가 IPv4 loopback이며 요청 후에도 같은 listener가 유지되는지 확인한다.

## 검증

- 수정된 초기화로 원래 인증 테스트 22개를 60회 반복: **1,320개 통과**.
- 통제 재현에서 기존 자동 wildcard 서버의 오접속 및 명시적 loopback 서버의 정상 응답 확인.
- 정규 `npm run check`: 스키마·서식·린트·타입·단위 164개·통합 210개·빌드 검증.

이 수정은 테스트 요청이 의도한 앱에 도달하도록 하는 조치다. 실패를 숨기는 재시도, 404 허용, 인증 조건 완화를 추가하지 않았다.
