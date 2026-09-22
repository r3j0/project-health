import type { Page } from "@playwright/test";
export const testUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "contract@example.test",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};
export const assignment = {
  id: "00000000-0000-4000-8000-000000000002",
  status: "assigned",
  assignedAt: "2026-09-01T00:00:00Z",
  completedAt: null,
  curriculum: {
    id: "00000000-0000-4000-8000-000000000003",
    name: "내 기존 운동",
  },
};
export const catalog = {
  version: "contract-test-v1",
  checkedOn: "2026-09-01",
  age: null,
  definitions: [
    ["height", "신장", "cm", "decimal", "physique", "body_composition", "0"],
    ["weight", "체중", "kg", "decimal", "physique", "body_composition", "0"],
    ["bmi", "BMI", "kg/m²", "decimal", "physique", "body_composition", "0"],
    [
      "waist_circumference",
      "허리둘레",
      "cm",
      "decimal",
      "physique",
      "body_composition",
      "0",
    ],
    [
      "cross_sit_up",
      "교차 윗몸일으키기",
      "회",
      "integer",
      "health_fitness",
      "muscular_endurance",
      "0",
    ],
    [
      "self_curl_up",
      "윗몸말아올리기",
      "회",
      "integer",
      "health_fitness",
      "muscular_endurance",
      "0",
    ],
    [
      "ymca_recovery_heart_rate",
      "YMCA 스텝검사 회복 심박수",
      "bpm",
      "integer",
      "health_fitness",
      "cardiorespiratory_endurance",
      "1",
    ],
    [
      "sit_and_reach",
      "앉아 윗몸 앞으로 굽히기",
      "cm",
      "decimal",
      "health_fitness",
      "flexibility",
      null,
    ],
  ].map(([code, label, unit, valueType, category, factor, minValue]) => ({
    code,
    label,
    unit,
    valueType,
    category,
    factor,
    minValue,
    maxValue: null,
    minInclusive: true,
    minAge: 19,
    maxAge: 64,
    sourceUrls: [],
  })),
};
export function testRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000004",
    catalogVersion: catalog.version,
    revision: 1,
    measuredOn: "2026-09-01",
    ageAtMeasurement: 25,
    sexAtMeasurement: "male",
    reportKind: "simple",
    centerName: null,
    reportedOverallGrade: null,
    entryMethod: "self_assessment",
    sourceProgram: "nfa100",
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    items: [
      {
        measurementCode: "sit_and_reach",
        value: "-2.5",
        unit: "cm",
        reportedGrade: null,
      },
    ],
    missingMeasurementCodes: [],
    evaluation: {
      status: "not_evaluated",
      reason: "evaluation_not_implemented",
    },
    ...overrides,
  };
}
/** HTTP contract doubles exist only in Playwright. No production fallback data. */
export async function installApi(
  page: Page,
  initialRecord?: ReturnType<typeof testRecord>,
) {
  let record = initialRecord;
  const mutations: { path: string; method: string; body: unknown }[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname.replace("/api/v1", "");
    const method = request.method();
    if (
      ["POST", "PATCH", "DELETE"].includes(method) &&
      !path.startsWith("/auth")
    )
      mutations.push({ path, method, body: request.postDataJSON() });
    const send = (json: unknown, status = 200) =>
      route.fulfill({
        status,
        json,
        headers: { ETag: '\"1\"', "Access-Control-Expose-Headers": "ETag" },
      });
    if (path === "/auth/refresh")
      return send({
        user: testUser,
        access_token: "test-token",
        expires_in: 900,
        token_type: "Bearer",
      });
    if (path === "/auth/me")
      return send({
        ...testUser,
        isOnboarded: !!record,
        currency: { balance: 0 },
        currentCurriculum: assignment,
      });
    if (path === "/measurement-catalog") return send(catalog);
    if (path === "/measurements" && method === "POST") {
      record = testRecord(request.postDataJSON());
      return send(record, 201);
    }
    if (path === "/measurements")
      return send({
        items: record ? [{ ...record, itemCount: record.items.length }] : [],
        nextCursor: null,
      });
    if (record && path === `/measurements/${record.id}`) return send(record);
    return send({ message: "API not implemented" }, 404);
  });
  return {
    mutations,
    get record() {
      return record;
    },
  };
}
