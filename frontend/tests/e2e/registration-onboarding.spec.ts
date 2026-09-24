import { test, expect } from "@playwright/test";
import { installApi, testUser } from "./integration-fixtures";

test("가입 실패는 폼을 유지하고 성공하면 메인 경유 없이 온보딩을 시작한다", async ({
  page,
}, info) => {
  await installApi(page);
  let registered = false;
  let attempts = 0;
  const auth = {
    user: testUser,
    access_token: "test-token",
    expires_in: 900,
    token_type: "Bearer",
  };
  await page.route("**/auth/refresh", (route) =>
    route.fulfill(
      registered
        ? { json: auth }
        : { status: 401, json: { message: "Anonymous" } },
    ),
  );
  await page.route("**/auth/register", (route) => {
    attempts++;
    if (attempts === 1)
      return route.fulfill({
        status: 409,
        json: { message: "Email already exists" },
      });
    registered = true;
    return route.fulfill({ status: 201, json: auth });
  });
  const destinations: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame())
      destinations.push(new URL(frame.url()).pathname);
  });
  await page.goto("/register?next=%2Faccount");
  await page
    .getByLabel("이메일", { exact: true })
    .fill("duplicate@example.test");
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill("registration-onboarding-test!");
  await page
    .getByLabel("비밀번호 확인", { exact: true })
    .fill("registration-onboarding-test!");
  await page.getByRole("button", { name: "가입하고 시작하기" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "이미 가입된 이메일",
  );
  await expect(page).toHaveURL("/register?next=%2Faccount");
  await expect(page.getByLabel("비밀번호", { exact: true })).toHaveValue(
    "registration-onboarding-test!",
  );
  await page.getByLabel("이메일", { exact: true }).fill(testUser.email);
  await page.getByRole("button", { name: "가입하고 시작하기" }).click();
  await expect(page).toHaveURL("/onboarding");
  await expect(
    page.getByRole("heading", { name: "체력 기록 시작하기", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "하단 메뉴" })).toHaveCount(
    0,
  );
  expect(destinations).not.toContain("/");
  expect(destinations).not.toContain("/account");
  expect(attempts).toBe(2);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [width, height] of [
    [320, 640],
    [390, 844],
    [1280, 900],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await expect(page.getByRole("main")).toHaveCSS("padding-bottom", "0px");
    await page.screenshot({
      path: info.outputPath(`onboarding-${width}.png`),
      fullPage: true,
    });
  }
  for (const [name, path] of [
    ["결과표 사진 선택", "/onboarding/photo"],
    ["결과 직접 입력", "/onboarding/manual"],
    ["간이측정 시작하기", "/workout?mode=assessment"],
  ]) {
    await page.getByRole("link", { name, exact: false }).click();
    await expect(page).toHaveURL(path);
    await page.goBack();
    await expect(page).toHaveURL("/onboarding");
    await expect(
      page.getByRole("navigation", { name: "하단 메뉴" }),
    ).toHaveCount(0);
  }
  await page
    .getByRole("link", { name: "나중에 등록하기", exact: true })
    .click();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("navigation", { name: "하단 메뉴" }),
  ).toBeVisible();
  await page.goBack();
  await page
    .getByRole("link", { name: "내 측정 기록 보기", exact: true })
    .click();
  await expect(page).toHaveURL("/measurements");
  await expect(page.getByText("첫 기록을 기다리고 있어요")).toBeVisible();
});
