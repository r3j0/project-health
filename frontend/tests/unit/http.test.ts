import test from "node:test";
import assert from "node:assert/strict";
import { request, ApiError } from "../../lib/http.ts";
test("multipart keeps browser boundary and Headers instances preserve auth", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      const headers = new Headers(options?.headers);
      assert.equal(headers.has("Content-Type"), false);
      assert.equal(headers.get("Authorization"), "Bearer test");
      assert.equal("timeoutMs" in options!, false);
      return Response.json({ ok: true });
    };
    await request("/measurements/extract", {
      method: "POST",
      body: new FormData(),
      headers: new Headers({ Authorization: "Bearer test" }),
      timeoutMs: 50000,
    });
  } finally {
    globalThis.fetch = original;
  }
});
test("extraction error codes and server retry delay survive transport", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json(
        { code: "EXTRACTION_RATE_LIMITED", retry_after: 17 },
        { status: 429 },
      );
    await assert.rejects(
      request("/measurements/extract"),
      (error: unknown) =>
        error instanceof ApiError &&
        error.code === "EXTRACTION_RATE_LIMITED" &&
        error.retryAfter === 17,
    );
  } finally {
    globalThis.fetch = original;
  }
});
