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

test("사진을 다시 선택해도 서버의 재요청 제한을 유지한다", async ({ page }) => {
  await installApi(page);
  await page.clock.install();
  let requests = 0;
  await page.route("**/measurements/extract", (route) => {
    requests++;
    return route.fulfill({
      status: 429,
      json: { code: "EXTRACTION_RATE_LIMITED", retry_after: 10 },
    });
  });
  await page.goto("/onboarding/photo");
  await page.getByLabel("결과표 파일 선택").setInputFiles(png);
  const analyze = page.getByRole("button", { name: "사진에서 측정값 읽기" });
  await analyze.click();
  await expect(page.locator(".notice[role=alert]")).toContainText(
    "요청이 많아요",
  );
  await expect(analyze).toBeDisabled();
  await page
    .getByLabel("결과표 파일 선택")
    .setInputFiles({ ...png, name: "another.png" });
  await expect(analyze).toBeDisabled();
  expect(requests).toBe(1);
  await page.clock.fastForward(10050);
  await expect(analyze).toBeEnabled();
});

test("사진 초안을 지우고 다시 선택해도 직접 입력 초안은 유지한다", async ({
  page,
}) => {
  await installApi(page);
  await page.goto("/onboarding/manual");
  await page.getByLabel("측정 당시 만 나이", { exact: true }).fill("30");
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "이전 화면", exact: true }).click();
  await page.getByRole("link", { name: "결과표가 있어요" }).click();
  await page.getByLabel("결과표 파일 선택").setInputFiles(png);
  await page.getByRole("button", { name: "이 사진을 보며 직접 입력" }).click();
  await page.getByLabel("측정 당시 만 나이", { exact: true }).fill("25");
  await page
    .getByRole("button", { name: "입력 지우고 다른 사진 선택" })
    .click();
  await expect(page.getByLabel("결과표 파일 선택")).toBeAttached();
  await expect(
    page.getByRole("img", { name: "선택한 국민체력100 결과표" }),
  ).toHaveCount(0);
  await page.getByLabel("결과표 파일 선택").setInputFiles(png);
  await page.getByRole("button", { name: "이 사진을 보며 직접 입력" }).click();
  await expect(
    page.getByLabel("측정 당시 만 나이", { exact: true }),
  ).toHaveValue("");
  await page.getByRole("link", { name: "이전 화면", exact: true }).click();
  await page.getByRole("link", { name: "직접 입력하기" }).click();
  await expect(
    page.getByLabel("측정 당시 만 나이", { exact: true }),
  ).toHaveValue("30");
});

test("서버 처리 제한 안의 느린 사진 분석도 조기 취소하지 않는다", async ({
  page,
}) => {
  await installApi(page);
  await page.route("**/measurements/extract", async (route) => {
    // Native AbortSignal.timeout uses real time. Exceed the old 50s client
    // deadline while remaining inside the backend's 75s processing budget.
    await new Promise((resolve) => setTimeout(resolve, 55000));
    await route.fulfill({ json: extraction }).catch(() => {});
  });
  await page.goto("/onboarding/photo");
  await page.getByLabel("결과표 파일 선택").setInputFiles(png);
  await page.getByRole("button", { name: "사진에서 측정값 읽기" }).click();
  await expect(
    page.getByRole("button", { name: "추출값 확인·수정" }),
  ).toBeVisible({ timeout: 65000 });
  await expect(page.locator(".notice[role=alert]")).toHaveCount(0);
});
