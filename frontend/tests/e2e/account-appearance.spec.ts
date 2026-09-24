import { test, expect } from "@playwright/test";
import { installApi } from "./integration-fixtures";
import {
  storedRecordFixture,
  storedCatalogFixture,
} from "../fixtures/measurement-evaluation";

test("프로필은 얼굴 모션과 축 아래 등급을 표시하고 기록 상세로 이어진다", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const record = storedRecordFixture();
  await installApi(page, record, storedCatalogFixture);
  await page.route("**/measurements/latest-polygon", (route) =>
    route.fulfill({
      json: {
        measurementId: record.id,
        revision: record.revision,
        measuredOn: record.measuredOn,
        axes: record.axes,
      },
    }),
  );
  await page.goto("/account");
  const avatar = page.getByRole("img", {
    name: "편안하게 숨 쉬는 햄스터 얼굴",
  });
  await expect(avatar).toBeVisible();
  const head = avatar.locator('[data-part="head"]');
  await expect(head).toHaveAttribute("transform", /translate/);
  const pose = await head.getAttribute("transform");
  await expect.poll(() => head.getAttribute("transform")).not.toBe(pose);
  await expect(avatar.locator('[data-part="torso"]')).toBeHidden();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(head).toHaveAttribute(
    "transform",
    "translate(0.0000 0.0000) rotate(0.0000 400 610)",
  );
  await expect(
    page.getByRole("heading", { name: "나의 체력 프로필" }),
  ).toHaveCount(0);
  await expect(page.getByText(/최신 측정 기록 기준/)).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "이 기록의 상세 리포트 보기" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".radar-legend, .fitness-radar figcaption"),
  ).toHaveCount(0);
  await expect(page.locator(".radar-label")).toHaveText([
    "심폐지구력",
    "근력",
    "근지구력",
    "유연성",
    "민첩성",
    "순발력",
  ]);
  await expect(page.locator(".radar-grade")).toHaveText([
    "평가 미존재",
    "평가 미존재",
    "평가 미존재",
    "2등급",
    "평가 미존재",
    "평가 미존재",
  ]);
  await expect(page.locator('.radar-point[cx="180"][cy="158"]')).toHaveCount(5);
  await expect(page.locator(".radar-shape")).toHaveCSS(
    "stroke",
    "rgb(255, 127, 0)",
  );
  for (const [width, height] of [
    [320, 640],
    [390, 844],
    [1280, 900],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    const chart = (await page.locator(".fitness-radar svg").boundingBox())!;
    const labels = await page.locator(".radar-label").all();
    for (const [index, grade] of (
      await page.locator(".radar-grade").all()
    ).entries()) {
      const name = (await labels[index].boundingBox())!;
      const value = (await grade.boundingBox())!;
      expect(value.y).toBeGreaterThan(name.y + name.height);
      expect(value.x).toBeGreaterThanOrEqual(chart.x);
      expect(value.x + value.width).toBeLessThanOrEqual(chart.x + chart.width);
      expect(value.y + value.height).toBeLessThanOrEqual(
        chart.y + chart.height,
      );
    }
    await page.screenshot({
      path: info.outputPath(`account-${width}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await page.getByRole("link", { name: "내 측정 기록", exact: true }).click();
  await page.locator(".record-card").click();
  await expect(page.locator(".radar-legend dd")).toHaveCount(6);
  await page.getByRole("link", { name: "메인", exact: true }).click();
  const fullBody = page.getByRole("img", { name: "편안하게 숨 쉬는 햄스터" });
  await expect(fullBody.locator('[data-part="torso"]')).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "하단 메뉴" }),
  ).not.toHaveClass(/kspo-orange-theme/);
  expect(errors).toEqual([]);
});
