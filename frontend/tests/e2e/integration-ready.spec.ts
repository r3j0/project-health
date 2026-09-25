import { test, expect } from "@playwright/test";
import { installApi } from "./integration-fixtures";
import { prepareAssessment, skipToFlexibility } from "./workout-helpers";
test("간이측정 등록은 기존 사용자 커리큘럼을 보존한다", async ({ page }) => {
  const server = await installApi(page);
  await page.goto("/workout");
  await expect(
    page.getByRole("heading", { name: "내 기존 운동" }),
  ).toBeVisible();
  await expect(page.getByLabel("만 나이", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "체력 기록 시작하기" }).click();
  await page.getByRole("link", { name: "결과표가 없어요" }).click();
  await prepareAssessment(page);
  await skipToFlexibility(page);
  await page.getByLabel("기준선에서 도달한 거리 (cm)").fill("0");
  await page.getByRole("button", { name: "결과 확인", exact: true }).click();
  await page
    .getByRole("button", { name: "측정 기록 저장", exact: true })
    .click();
  await page.getByRole("link", { name: "측정 기록 보기", exact: true }).click();
  await expect(page).toHaveURL(/measurements\/.+saved=1/);
  expect(server.mutations.map((m) => [m.method, m.path])).toEqual([
    ["POST", "/measurements"],
  ]);
  expect(server.record?.entryMethod).toBe("self_assessment");
  expect(server.record?.reportKind).toBe("unknown");
  await page.goto("/workout");
  await expect(
    page.getByRole("heading", { name: "내 기존 운동" }),
  ).toBeVisible();
  await expect(page.getByText("배정됨", { exact: true })).toBeVisible();
});
