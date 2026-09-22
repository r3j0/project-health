import { test, expect } from "@playwright/test";
import { installApi, testRecord } from "./integration-fixtures";
import { evaluatedFixture, recordIdentity } from "../fixtures/fitness";

test("평가가 하나여도 6축을 연결하고 상세 기준과 원래 결과표 등급을 구분한다", async ({
  page,
}) => {
  await installApi(
    page,
    testRecord({
      evaluation: evaluatedFixture(),
      items: [
        {
          measurementCode: "sit_and_reach",
          value: "-2.5",
          unit: "cm",
          reportedGrade: "결과표 직접 입력 등급",
        },
      ],
    }),
  );
  await page.goto(`/measurements/${recordIdentity.id}`);
  await expect(
    page.getByRole("img", { name: "6가지 체력 요인별 등급" }),
  ).toBeVisible();
  await expect(page.locator(".radar-point")).toHaveCount(6);
  await expect(page.locator('.radar-point[cx="180"][cy="158"]')).toHaveCount(5);
  await expect(page.getByTestId("radar-path")).toHaveAttribute("d", / Z$/);
  await page.getByText("유연성 · 2등급", { exact: true }).click();
  await expect(
    page.getByText("대표 등급 반영: 앉아 윗몸 앞으로 굽히기"),
  ).toBeVisible();
  await expect(page.getByText(/현재 값과의 차이 12.5 cm/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "국민체력100 인증기준 (새 창)" }),
  ).toHaveAttribute("href", /^https:\/\/nfa.kspo.or.kr/);
  await expect(
    page.getByText("결과표 등급: 결과표 직접 입력 등급"),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/private/tmp/project-health-fitness-report-mobile.png",
    fullPage: true,
  });
});

test("이전 API와 오래된 평가 응답에서도 원본 기록과 편집 진입이 유지된다", async ({
  page,
}) => {
  const e = evaluatedFixture();
  e.measurementRevision = 2;
  await installApi(page, testRecord({ evaluation: e }));
  await page.goto(`/measurements/${recordIdentity.id}`);
  await expect(page.getByText(/평가 정보를 확인하지 못했어요/)).toBeVisible();
  await expect(page.locator(".radar-point")).toHaveCount(0);
  await expect(page.getByText("-2.5 cm", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "기록 수정", exact: true }).click();
  await expect(
    page.getByLabel("앉아 윗몸 앞으로 굽히기", { exact: true }),
  ).toHaveValue("-2.5");
});

test("여섯 축 모두 평가가 없어도 원점을 연결한 다각형을 표시한다", async ({
  page,
}) => {
  const e = evaluatedFixture();
  e.axes = e.axes.map((a) => ({
    ...a,
    status: "unsupported_rule",
    grade: null,
    reason: "지원 기준이 없어요.",
    sourceMeasurementCodes: [],
  }));
  e.items = e.items.map((i) => ({
    ...i,
    status: "unsupported_rule",
    grade: null,
    reason: "지원 기준이 없어요.",
    criteria: null,
  }));
  await installApi(page, testRecord({ evaluation: e }));
  await page.goto(`/measurements/${recordIdentity.id}`);
  await expect(page.locator('.radar-point[cx="180"][cy="158"]')).toHaveCount(6);
  await expect(page.getByTestId("radar-path")).toHaveAttribute(
    "d",
    "M 180 158 L 180 158 L 180 158 L 180 158 L 180 158 L 180 158 Z",
  );
});
