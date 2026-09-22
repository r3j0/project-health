import { test, expect } from "@playwright/test";
import { installApi, testRecord, testUser } from "./integration-fixtures";
import { evaluatedFixture, recordIdentity } from "../fixtures/fitness";

test("대표 프로필은 최신 한 기록만 사용하고 수정·삭제 후 다시 조회한다", async ({
  page,
}) => {
  const server = await installApi(
    page,
    testRecord({ evaluation: evaluatedFixture() }),
  );
  let reads = 0;
  await page.route("**/users/me/fitness-profile", (route) => {
    reads++;
    const r = server.record;
    // Model backend atomic evaluation of the current record, not a frontend fallback.
    const e = evaluatedFixture();
    if (r) {
      e.measurementRevision = r.revision;
      e.items[0].value = r.items[0].value;
    }
    return route.fulfill({
      json: {
        measurement: r
          ? { id: r.id, revision: r.revision, measuredOn: r.measuredOn }
          : null,
        evaluation: r ? e : null,
      },
    });
  });
  await page.goto("/");
  await expect(page.locator(".latest-fitness .radar-point")).toHaveCount(6);
  await expect(page.locator(".latest-fitness")).toContainText(
    "2026년 9월 1일 · 최신 측정 기록 기준",
  );
  await page.getByRole("link", { name: "이 기록의 상세 리포트 보기" }).click();
  await expect(page).toHaveURL(`/measurements/${recordIdentity.id}`);
  await page.getByRole("link", { name: "기록 수정", exact: true }).click();
  await page.getByLabel("앉아 윗몸 앞으로 굽히기", { exact: true }).fill("0");
  await page.getByRole("button", { name: "수정 내용 저장" }).click();
  await expect(page).toHaveURL(/saved=1/);
  expect(server.record?.revision).toBe(2);
  const before = reads;
  await page
    .getByRole("navigation", { name: "하단 메뉴" })
    .getByRole("link", { name: "메인", exact: true })
    .click();
  await expect(page.locator(".latest-fitness .radar-point")).toHaveCount(6);
  expect(reads).toBeGreaterThan(before);
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
  await expect(
    page.getByRole("heading", { name: "내 체력 기록부터 시작해요" }),
  ).toBeVisible();
  await expect(page.locator(".radar-point")).toHaveCount(0);
  expect(server.mutations.map((m) => m.method)).toEqual(["PATCH", "DELETE"]);
});

test("대표 API 미연결과 빈 기록을 구분하고 다른 기록으로 보충하지 않는다", async ({
  page,
}) => {
  await installApi(page, testRecord());
  await page.goto("/");
  await expect(page.getByText(/체력 프로필을 준비 중이에요/)).toBeVisible();
  await expect(page.locator(".radar-point")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "내 측정 기록 보기", exact: true }),
  ).toBeVisible();
  await page.route("**/users/me/fitness-profile", (route) =>
    route.fulfill({ json: { measurement: null, evaluation: null } }),
  );
  await page.getByRole("button", { name: "체력 프로필 다시 확인" }).click();
  await expect(
    page.getByText("아직 등록한 측정 기록이 없어요.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".radar-point")).toHaveCount(0);
});

test("다른 탭에서 기록을 변경하면 이전 차트를 즉시 숨기고 늦은 응답을 버린다", async ({
  page,
}) => {
  await installApi(page, testRecord({ evaluation: evaluatedFixture() }));
  let count = 0;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/users/me/fitness-profile", async (route) => {
    const index = ++count;
    if (index === 2) await held;
    await route
      .fulfill({
        json:
          index < 3
            ? { measurement: recordIdentity, evaluation: evaluatedFixture() }
            : { measurement: null, evaluation: null },
      })
      .catch(() => {});
  });
  await page.goto("/");
  await expect(page.locator(".radar-point")).toHaveCount(6);
  const broadcast = async () => {
    const other = await page.context().newPage();
    await other.route("**/contract-broadcast", (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
    );
    await other.goto("/contract-broadcast");
    await other.evaluate((id) => {
      const c = new BroadcastChannel("modu-auth-session");
      c.postMessage({ type: "profile-changed", userId: id });
      c.close();
    }, testUser.id);
    await other.close();
  };
  await broadcast();
  await expect.poll(() => count).toBeGreaterThanOrEqual(2);
  await expect(page.locator(".radar-point")).toHaveCount(0);
  await broadcast();
  await expect(
    page.getByText("아직 등록한 측정 기록이 없어요.", { exact: true }),
  ).toBeVisible();
  release();
  await expect(page.locator(".radar-point")).toHaveCount(0);
});
