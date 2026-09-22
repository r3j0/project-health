import { test, expect } from "@playwright/test";
import { installApi, catalog } from "./integration-fixtures";
const png = {
  name: "report.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  ),
};
const extraction = {
  catalogVersion: catalog.version,
  status: "partial",
  metadata: {
    measuredOn: "2026-09-01",
    ageAtMeasurement: 25,
    sexAtMeasurement: "male",
    centerName: null,
    reportedOverallGrade: null,
  },
  items: [
    {
      measurementCode: "sit_and_reach",
      value: "-3.12345678901234567890",
      unit: "cm",
      reportedGrade: null,
      evidence: {
        label: "유연성",
        value: "-3.12345678901234567890",
        unit: "cm",
      },
    },
  ],
  reviewItems: [
    {
      measurementCode: null,
      value: "32",
      unit: "kg",
      reportedGrade: null,
      evidence: { label: "악력", value: "32", unit: "kg" },
      reasons: ["UNKNOWN_TEST"],
    },
  ],
  issues: [
    {
      code: "ITEM_REVIEW_REQUIRED",
      field: "reviewItems",
      requiresInput: false,
    },
  ],
  notDetectedMeasurementCodes: [],
};
test("사진 추출은 저장하지 않고 확인한 값만 기존 API로 저장한다", async ({
  page,
}) => {
  const server = await installApi(page);
  let extractions = 0;
  await page.route("**/measurements/extract", async (route) => {
    extractions++;
    expect(route.request().headers()["content-type"]).toContain(
      "multipart/form-data; boundary=",
    );
    expect(route.request().postDataBuffer()?.toString()).toContain(
      'name="image"',
    );
    await route.fulfill({ json: extraction });
  });
  await page.goto("/onboarding/photo");
  await page.getByLabel("결과표 파일 선택").setInputFiles(png);
  await page.getByRole("button", { name: "사진에서 측정값 읽기" }).click();
  await expect(
    page.getByText("읽은 측정값 1개 · 확인할 항목 1개"),
  ).toBeVisible();
  expect(server.mutations).toHaveLength(0);
  await page.getByRole("button", { name: "추출값 확인·수정" }).click();
  await expect(page.getByText(/악력: 32 kg/)).toBeVisible();
  await page.getByRole("button", { name: "측정값 입력하기" }).click();
  await expect(
    page.getByLabel("앉아 윗몸 앞으로 굽히기", { exact: true }),
  ).toHaveValue(extraction.items[0].value);
  await page.reload();
  await expect(
    page.getByLabel("앉아 윗몸 앞으로 굽히기", { exact: true }),
  ).toHaveValue(extraction.items[0].value);
  await expect(page.getByText(/악력: 32 kg/)).toBeVisible();
  await page
    .getByRole("button", { name: "1개 항목 저장하기", exact: true })
    .click();
  await expect(page).toHaveURL("/");
  expect(extractions).toBe(1);
  expect(server.mutations).toHaveLength(1);
  expect(server.record?.items).toEqual([
    {
      measurementCode: "sit_and_reach",
      value: extraction.items[0].value,
      unit: "cm",
      reportedGrade: null,
    },
  ]);
  expect(server.mutations[0].body).not.toHaveProperty("evidence");
});
test("사진 분석 실패 후 직접 입력 가능하며 여러 사람 결과는 자동 입력하지 않는다", async ({
  page,
}) => {
  await installApi(page);
  let count = 0;
  await page.route("**/measurements/extract", (route) =>
    route.fulfill(
      ++count === 1
        ? { status: 503, json: { code: "EXTRACTION_UNAVAILABLE" } }
        : {
            json: {
              ...extraction,
              status: "multiple_people",
              items: [],
              reviewItems: [],
              metadata: {
                ...extraction.metadata,
                measuredOn: null,
                ageAtMeasurement: null,
                sexAtMeasurement: null,
              },
            },
          },
    ),
  );
  await page.goto("/onboarding/photo");
  await page.getByLabel("결과표 파일 선택").setInputFiles(png);
  await page.getByRole("button", { name: "사진에서 측정값 읽기" }).click();
  await expect(page.locator(".notice[role=alert]")).toContainText(
    "아직 사용할 수 없어요",
  );
  await expect(
    page.getByRole("button", { name: "이 사진을 보며 직접 입력" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "사진에서 측정값 읽기" }).click();
  await expect(page.getByText(/여러 사람의 결과가 섞여/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "추출값 확인·수정" }),
  ).toHaveCount(0);
});
test("분석 취소 후 늦은 응답으로 입력 화면이 바뀌지 않는다", async ({
  page,
}) => {
  await installApi(page);
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/measurements/extract", async (route) => {
    await pending;
    await route.fulfill({ json: extraction }).catch(() => {});
  });
  await page.goto("/onboarding/photo");
  await page.getByLabel("결과표 파일 선택").setInputFiles(png);
  const sent = page.waitForRequest("**/measurements/extract");
  await page.getByRole("button", { name: "사진에서 측정값 읽기" }).click();
  await sent;
  await page.getByRole("button", { name: "분석 취소" }).click();
  release();
  await expect(page.locator(".notice[role=alert]")).toContainText("취소했어요");
  await expect(
    page.getByRole("button", { name: "추출값 확인·수정" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "사진에서 측정값 읽기" }),
  ).toBeEnabled();
});
