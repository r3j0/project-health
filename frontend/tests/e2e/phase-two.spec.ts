import { test, expect, type Page, type Route } from "@playwright/test";

const api = process.env.E2E_API_BASE_URL ?? "http://localhost:3001/api/v1";
const password = "phase-two-test-password-2026!";
async function register(page: Page) {
  const email = `phase-two-${crypto.randomUUID()}@example.test`;
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  const response = await page.request.post(`${api}/auth/register`, {
    headers: { Origin: origin, "X-CSRF-Protection": "1" },
    data: { email, password },
  });
  expect(response.status()).toBe(201);
  return { email, ...(await response.json()) };
}
function fail(route: Route, status: number, extra = {}) {
  return route.fulfill({
    status,
    json: { message: "Injected error", ...extra },
    headers: {
      "Access-Control-Allow-Origin": route.request().headers().origin,
      "Access-Control-Allow-Credentials": "true",
    },
  });
}

async function login(page: Page, email: string, secret = password) {
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("계정 수정은 비밀번호 오류를 재전송하지 않고 성공하면 모든 탭에서 로그아웃한다", async ({
  page,
  context,
}) => {
  const account = await register(page);
  await page.goto("/account/settings");
  const other = await context.newPage();
  await other.goto("/account");
  await expect(other.getByText(account.email, { exact: true })).toBeVisible();
  let updates = 0;
  page.on("request", (request) => {
    if (request.url() === `${api}/users/me` && request.method() === "PATCH")
      updates++;
  });
  const email = `changed-${crypto.randomUUID()}@example.test`;
  await page.getByLabel("새 이메일", { exact: true }).fill(email);
  await page.getByLabel("현재 비밀번호").fill("incorrect-password");
  await page
    .getByRole("button", { name: "이메일 변경", exact: true })
    .last()
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "본인 확인에 실패",
  );
  expect(updates).toBe(1);
  await expect(other.getByText(account.email, { exact: true })).toBeVisible();
  await page.getByLabel("현재 비밀번호").fill(password);
  await page
    .getByRole("button", { name: "이메일 변경", exact: true })
    .last()
    .click();
  await expect(page).toHaveURL(/\/login/);
  await expect(other).toHaveURL(/\/login/);
  expect(updates).toBe(2);
  expect(
    (
      await page.request.get(`${api}/auth/me`, {
        headers: { Authorization: `Bearer ${account.access_token}` },
      })
    ).status(),
  ).toBe(401);
  await login(page, email);
  await page.goto("/account");
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await expect(page.getByText("보유 재화", { exact: true })).toBeVisible();
});

test("새 비밀번호 확인 후 변경하고 재로그인하여 영구 탈퇴한다", async ({
  page,
}) => {
  const { email } = await register(page);
  await page.goto("/account/settings");
  await page
    .getByRole("button", { name: "비밀번호 변경", exact: true })
    .click();
  const updated = "new-password-with-spaces 2026! ";
  await page.getByLabel("새 비밀번호", { exact: true }).fill(updated);
  await page.getByLabel("새 비밀번호 확인").fill("does-not-match-2026");
  await page.getByLabel("현재 비밀번호").fill(password);
  await page
    .getByRole("button", { name: "비밀번호 변경", exact: true })
    .last()
    .click();
  await expect(page.getByText("새 비밀번호가 일치하지 않아요.")).toBeVisible();
  await page.getByLabel("새 비밀번호 확인").fill(updated);
  await page
    .getByRole("button", { name: "비밀번호 변경", exact: true })
    .last()
    .click();
  await expect(page).toHaveURL(/\/login/);
  await login(page, email, updated);
  await page.goto("/account/settings");
  await page.getByRole("button", { name: "회원 탈퇴", exact: true }).click();
  await page.getByLabel("현재 비밀번호").fill(updated);
  await page
    .getByRole("button", { name: "회원 탈퇴", exact: true })
    .last()
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "취소" }).click();
  await expect(page).toHaveURL(/\/account\/settings/);
  await page
    .getByRole("button", { name: "회원 탈퇴", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "영구 탈퇴하기" }).click();
  await expect(page).toHaveURL(/\/login/);
  const response = await page.request.post(`${api}/auth/login`, {
    headers: { Origin: new URL(page.url()).origin, "X-CSRF-Protection": "1" },
    data: { email, password: updated },
  });
  expect(response.status()).toBe(401);
});

test("중복 이메일과 요청 제한은 입력을 보존하고 재시도할 수 있다", async ({
  page,
}) => {
  const owner = await register(page);
  await register(page);
  await page.goto("/account/settings");
  await page.getByLabel("새 이메일", { exact: true }).fill(owner.email);
  await page.getByLabel("현재 비밀번호").fill(password);
  await page
    .getByRole("button", { name: "이메일 변경", exact: true })
    .last()
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "이미 사용 중인 이메일",
  );
  await page.route(`${api}/users/me`, (route) =>
    route.request().method() === "PATCH"
      ? fail(route, 429, { retry_after: 2 })
      : route.continue(),
  );
  await page
    .getByRole("button", { name: "이메일 변경", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("button", { name: /초 후 다시 시도/ }),
  ).toBeDisabled();
  await expect(page.getByLabel("새 이메일", { exact: true })).toHaveValue(
    owner.email,
  );
  await expect(
    page.getByRole("button", { name: "이메일 변경", exact: true }).last(),
  ).toBeEnabled();
});

test("공통 사용자 상태를 화면 이동에서 공유하고 새로고침 후 복원한다", async ({
  page,
}) => {
  const { email } = await register(page);
  let reads = 0;
  page.on("request", (request) => {
    if (request.url() === `${api}/auth/me` && request.method() === "GET")
      reads++;
  });
  await page.goto("/account");
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  const first = reads;
  await page.getByRole("link", { name: "메인", exact: true }).click();
  await page.getByRole("link", { name: "내 프로필", exact: true }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  expect(reads).toBe(first);
  await page.reload();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  expect(reads).toBeGreaterThan(first);
});

test("사용자 상태 조회 실패를 재시도하고 로그아웃을 유지한다", async ({
  page,
}) => {
  const { email } = await register(page);
  await page.route(`${api}/auth/me`, (route) =>
    route.request().method() === "GET" ? fail(route, 503) : route.continue(),
  );
  await page.goto("/account");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "서버가 잠시 응답하지 않아요",
  );
  await expect(
    page.getByRole("button", { name: "로그아웃", exact: true }),
  ).toBeEnabled();
  await page.unroute(`${api}/auth/me`);
  await page.getByRole("button", { name: "다시 불러오기" }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
});
