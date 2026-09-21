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
