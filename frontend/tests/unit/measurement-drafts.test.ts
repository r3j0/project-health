import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDraftStore,
  draftLifetime,
  type MeasurementDraft,
} from "../../lib/measurement-drafts.ts";

function storage() {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
}
const draft: MeasurementDraft = {
  meta: {
    measuredOn: "2026-09-17",
    age: "25",
    sex: "",
    kind: "unknown",
    center: "",
    grade: "",
  },
  items: [{ code: "height", value: "170.1234567890123456789", grade: "" }],
  step: 2,
  catalogVersion: "catalog-v1",
  pending: null,
  uncertain: false,
  gone: false,
  dirty: true,
};
test("same-account reauthentication and reload recover exact input", () => {
  const tab = storage();
  const first = createDraftStore(() => tab);
  first.setOwner("alice");
  first.save("alice", "new", draft);
  first.suspend();
  assert.equal(first.read("alice", "new"), undefined);
  first.setOwner("alice");
  assert.deepEqual(first.read("alice", "new"), draft);
  const reloaded = createDraftStore(() => tab);
  reloaded.setOwner("alice");
  assert.deepEqual(reloaded.read("alice", "new"), draft);
});
test("account switching erases other accounts, including after a page reload", () => {
  const tab = storage();
  const first = createDraftStore(() => tab);
  first.setOwner("alice");
  first.save("alice", "new", draft);
  const reloaded = createDraftStore(() => tab);
  reloaded.setOwner("bob");
  assert.equal(reloaded.read("alice", "new"), undefined);
  reloaded.save("alice", "new", draft);
  reloaded.setOwner("alice");
  assert.equal(reloaded.read("alice", "new"), undefined);
  assert.equal(tab.length, 0);
});
test("explicit logout erases drafts and rejects late writes", () => {
  const tab = storage();
  const store = createDraftStore(() => tab);
  tab.setItem("unrelated", "keep");
  store.setOwner("alice");
  store.save("alice", "new", draft);
  store.clear();
  store.save("alice", "new", draft);
  store.setOwner("alice");
  assert.equal(store.read("alice", "new"), undefined);
  assert.equal(tab.length, 1);
});
test("unresolved requests retain their original key and body even after the normal draft lifetime", () => {
  let time = 0;
  const tab = storage();
  const store = createDraftStore(
    () => tab,
    () => time,
  );
  const pending = {
    body: '{"items":[{"value":"170.1234567890123456789"}]}',
    key: "original-request-key",
  };
  store.setOwner("alice");
  store.save("alice", "new", { ...draft, pending, uncertain: true });
  time += draftLifetime + 1;
  const reloaded = createDraftStore(
    () => tab,
    () => time,
  );
  reloaded.setOwner("alice");
  assert.deepEqual(reloaded.read("alice", "new")?.pending, pending);
});
test("ordinary expired and malformed drafts are discarded", () => {
  let time = 0;
  const tab = storage();
  const store = createDraftStore(
    () => tab,
    () => time,
  );
  store.setOwner("alice");
  store.save("alice", "new", draft);
  time += draftLifetime + 1;
  assert.equal(store.read("alice", "new"), undefined);
  assert.equal(tab.length, 0);
  store.save("alice", "new", draft);
  const key = tab.key(0)!;
  tab.setItem(key, "not-json");
  const reloaded = createDraftStore(() => tab);
  reloaded.setOwner("alice");
  assert.equal(reloaded.read("alice", "new"), undefined);
  assert.equal(tab.length, 0);
});
test("storage failures preserve a draft in memory across reauthentication", () => {
  const store = createDraftStore(() => {
    throw new Error("Storage blocked");
  });
  store.setOwner("alice");
  store.save("alice", "new", draft);
  store.suspend();
  store.setOwner("alice");
  assert.deepEqual(store.read("alice", "new"), draft);
  store.clear();
  store.setOwner("alice");
  assert.equal(store.read("alice", "new"), undefined);
});
test("edit drafts retain their original ETag independently from new records", () => {
  const store = createDraftStore(storage);
  store.setOwner("alice");
  store.save("alice", "record-1", { ...draft, etag: '"1"' });
  store.save("alice", "new", draft);
  assert.equal(store.read("alice", "record-1")?.etag, '"1"');
  store.remove("alice", "new");
  assert.equal(store.read("alice", "new"), undefined);
  assert.equal(store.read("alice", "record-1")?.etag, '"1"');
});
