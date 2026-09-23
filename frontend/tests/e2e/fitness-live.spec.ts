import { test, expect, type Page } from "@playwright/test";
const api = process.env.E2E_API_BASE_URL ?? "http://localhost:3001/api/v1";
const password = "fitness-live-test-2026!";
const today = () =>
  new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
let headers: Record<string, string>, version: string;
const examples = [
  ["왕복오래달리기(20m)", "44", "shuttle_run_20m", "회"],
  ["상대악력", "51.6", "relative_grip_strength", "%"],
  ["교차윗몸일으키기", "51", "cross_sit_up", "회"],
  ["앉아윗몸앞으로굽히기", "10.1", "sit_and_reach", "cm"],
  ["반응시간", "0.335", "reaction_time", "초"],
  ["제자리 멀리뛰기", "223", "standing_long_jump", "cm"],
];
// These scenarios use real HTTP responses, never route.fulfill or grade fixtures.
test.beforeEach(async ({ page }) => {
  headers = {
    Origin: new URL(test.info().project.use.baseURL as string).origin,
    "X-CSRF-Protection": "1",
  };
  const r = await page.request.post(`${api}/auth/register`, {
    headers,
    data: {
      email: `fitness-live-${crypto.randomUUID()}@example.test`,
      password,
    },
  });
  expect(r.status()).toBe(201);
  headers.Authorization = `Bearer ${(await r.json()).access_token}`;
  const catalog = await page.request.get(`${api}/measurement-catalog`);
  expect(catalog.status()).toBe(200);
  version = (await catalog.json()).version;
});
test.afterEach(async ({ page }) => {
  if (headers.Authorization) {
    const removed = await page.request.delete(`${api}/users/me`, {
      headers,
      data: { password },
    });
    expect(removed.status()).toBe(204);
  }
});
async function add(page: Page, label: string, value: string) {
  await page
    .getByRole("button", { name: "측정 항목 추가", exact: true })
    .click();
  await page.getByRole("dialog").getByLabel("검사명 검색").fill(label);
  await page
    .getByRole("dialog")
    .getByRole("button")
    .filter({ hasText: label })
    .click();
  await page.getByLabel(label, { exact: true }).fill(value);
}
async function seed(page: Page, overrides: Record<string, unknown> = {}) {
  const response = await page.request.post(`${api}/measurements`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: {
      catalogVersion: version,
      measuredOn: today(),
      ageAtMeasurement: 25,
      sexAtMeasurement: "male",
      items: examples.map(([, value, measurementCode, unit]) => ({
        measurementCode,
        value,
        unit,
      })),
      ...overrides,
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}
test("실제 API: 6종목 직접 입력·상세 등급·기준·수정 재평가", async ({
  page,
}, info) => {
  await page.goto("/measurements");
  await page
    .getByRole("link", { name: "첫 측정 기록 등록", exact: true })
    .click();
  await expect(page).toHaveURL("/onboarding");
  await page.getByRole("link", { name: "결과 직접 입력" }).click();
  await page.getByLabel("측정일", { exact: true }).fill(today());
  await page.getByLabel("측정 당시 만 나이", { exact: true }).fill("25");
  await page.getByText("추가 정보", { exact: false }).click();
  await page.getByLabel("결과표의 성별").selectOption("male");
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
  for (const [label, value] of examples) await add(page, label, value);
  const waiting = page.waitForResponse(
    (r) => r.url() === `${api}/measurements` && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "6개 항목 저장하기" }).click();
  const response = await waiting;
  expect(response.status()).toBe(201);
  const saved = await response.json();
  expect(saved.axes.map((a: { grade: number }) => a.grade)).toEqual([
    2, 3, 1, 2, 2, 1,
  ]);
  await expect(page).toHaveURL("/");
  await page.goto(`/measurements/${saved.id}`);
  await expect(page.locator(".radar-legend dd")).toHaveText([
    "2등급",
    "3등급",
    "1등급",
    "2등급",
    "2등급",
    "1등급",
  ]);
  await expect(page.locator(".radar-point")).toHaveCount(6);
  await page.getByText("유연성 · 2등급", { exact: true }).click();
  await expect(page.getByText(/현재 값과의 차이 4.8 cm/)).toBeVisible();
  await page.screenshot({
    path: info.outputPath("real-detail.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "기록 수정", exact: true }).click();
  await page.getByLabel("앉아윗몸앞으로굽히기", { exact: true }).fill("14.9");
  await add(page, "트레드밀(VO₂max)", "44.8");
  await page.getByRole("button", { name: "수정 내용 저장" }).click();
  await expect(page).toHaveURL(/saved=1/);
  await expect(page.locator(".radar-legend dd")).toHaveText([
    "1등급",
    "3등급",
    "1등급",
    "1등급",
    "2등급",
    "1등급",
  ]);
  await page.reload();
  await expect(page.locator(".radar-legend dd").nth(3)).toHaveText("1등급");
  const stored = await page.request.get(`${api}/measurements/${saved.id}`, {
    headers,
  });
  const changed = await stored.json();
  expect(changed.revision).toBe(2);
  expect(
    changed.items.every(
      (i: { evaluation: { recordRevision: number } }) =>
        i.evaluation.recordRevision === 2,
    ),
  ).toBe(true);
});
test("실제 API: 미측정·정보 부족·기준 미확보·0회·음수를 구별한다", async ({
  page,
}) => {
  const saved = await seed(page, {
    entryMethod: "self_assessment",
    items: [
      { measurementCode: "cross_sit_up", value: "0", unit: "회" },
      { measurementCode: "sit_and_reach", value: "-2.5", unit: "cm" },
      { measurementCode: "ymca_recovery_heart_rate", value: "90", unit: "bpm" },
    ],
  });
  await page.goto(`/measurements/${saved.id}`);
  await expect(page.locator(".radar-legend dd")).toHaveText([
    "평가 불가 · 기준 없음",
    "평가 미존재 · 미측정",
    "기준 미달",
    "기준 미달",
    "평가 미존재 · 미측정",
    "평가 미존재 · 미측정",
  ]);
  await expect(page.locator('.radar-point[cx="180"][cy="158"]')).toHaveCount(4);
  await expect(page.getByTestId("radar-path")).toHaveAttribute("d", / Z$/);
  const patch = await page.request.patch(`${api}/measurements/${saved.id}`, {
    headers: { ...headers, "If-Match": '"1"' },
    data: { sexAtMeasurement: null },
  });
  expect(patch.status()).toBe(200);
  await page.reload();
  await expect(page.locator(".radar-legend dd").nth(3)).toHaveText(
    "평가 불가 · 정보 부족",
  );
  await expect(page.locator('.radar-point[cx="180"][cy="158"]')).toHaveCount(6);
});

test("실제 API: 메인·계정은 최신 한 회차만 표시하고 수정·삭제 후 갱신한다", async ({
  page,
}, info) => {
  const yesterday = new Date(Date.now() + 9 * 3600000 - 86400000)
    .toISOString()
    .slice(0, 10);
  const older = await seed(page, { measuredOn: yesterday });
  const partial = await seed(page, {
    entryMethod: "self_assessment",
    items: [{ measurementCode: "sit_and_reach", value: "10.1", unit: "cm" }],
  });
  for (const path of ["/", "/account"]) {
    await page.goto(path);
    await expect(page.locator(".latest-fitness .radar-point")).toHaveCount(6);
    await expect(
      page.locator('.latest-fitness .radar-point[cx="180"][cy="158"]'),
    ).toHaveCount(5);
    await expect(page.locator(".latest-fitness .radar-legend dd")).toHaveText([
      "평가 미존재 · 미측정",
      "평가 미존재 · 미측정",
      "평가 미존재 · 미측정",
      "2등급",
      "평가 미존재 · 미측정",
      "평가 미존재 · 미측정",
    ]);
    await expect(
      page.getByRole("link", { name: "이 기록의 상세 리포트 보기" }),
    ).toHaveAttribute("href", `/measurements/${partial.id}`);
  }
  await page.screenshot({
    path: info.outputPath("real-latest-partial.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "이 기록의 상세 리포트 보기" }).click();
  await page.getByRole("link", { name: "기록 수정", exact: true }).click();
  await page.getByLabel("앉아윗몸앞으로굽히기", { exact: true }).fill("14.9");
  await page.getByRole("button", { name: "수정 내용 저장" }).click();
  await expect(page).toHaveURL(/saved=1/);
  await page
    .getByRole("navigation", { name: "하단 메뉴" })
    .getByRole("link", { name: "메인", exact: true })
    .click();
  await expect(
    page.locator(".latest-fitness .radar-legend dd").nth(3),
  ).toHaveText("1등급");
  await page.getByRole("link", { name: "이 기록의 상세 리포트 보기" }).click();
  await page.getByRole("button", { name: "기록 삭제", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "기록 삭제", exact: true })
    .click();
  await expect(page).toHaveURL("/measurements");
  await page
    .getByRole("navigation", { name: "하단 메뉴" })
    .getByRole("link", { name: "메인", exact: true })
    .click();
  await expect(page.locator(".latest-fitness .radar-legend dd")).toHaveText([
    "2등급",
    "3등급",
    "1등급",
    "2등급",
    "2등급",
    "1등급",
  ]);
  await expect(
    page.getByRole("link", { name: "이 기록의 상세 리포트 보기" }),
  ).toHaveAttribute("href", `/measurements/${older.id}`);
  const removed = await page.request.delete(`${api}/measurements/${older.id}`, {
    headers: { ...headers, "If-Match": '"1"' },
  });
  expect(removed.status()).toBe(204);
  const empty = await page.request.get(`${api}/measurements/latest-polygon`, {
    headers,
  });
  expect(empty.status()).toBe(200);
  expect(await empty.json()).toMatchObject({
    measurementId: null,
    measuredOn: null,
    revision: null,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "내 체력 기록부터 시작해요" }),
  ).toBeVisible();
  await expect(page.locator(".radar-point")).toHaveCount(0);
});
