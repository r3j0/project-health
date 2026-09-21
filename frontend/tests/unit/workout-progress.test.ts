import test from "node:test";
import assert from "node:assert/strict";
import {
  initialWorkout,
  advanceWorkout,
  demoWorkout,
} from "../../lib/workout.ts";
import {
  readWorkoutProgress,
  saveWorkoutProgress,
  setWorkoutOwner,
} from "../../lib/workout-progress.ts";

test("workout progress validates expiry in memory and rejects writes from a previous account", () => {
  // No window/sessionStorage: exercise the supported memory fallback.
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    setWorkoutOwner("first", true);
    const active = advanceWorkout(demoWorkout, initialWorkout(), {
      type: "start",
      now,
    });
    now += 1500;
    saveWorkoutProgress("first", active);
    const restored = readWorkoutProgress("first");
    assert.equal(restored?.remainingMs, 8500);
    assert.equal(restored?.runningSince, null);
    setWorkoutOwner(null); // Session expiration preserves same-account progress.
    setWorkoutOwner("first");
    assert.equal(readWorkoutProgress("first")?.phase, "active");
    now += 24 * 3600000 + 1;
    assert.equal(readWorkoutProgress("first"), null);
    saveWorkoutProgress("first", active);
    setWorkoutOwner("second");
    saveWorkoutProgress("first", active);
    assert.equal(readWorkoutProgress("second"), null);
    setWorkoutOwner("first");
    assert.equal(readWorkoutProgress("first"), null);
    saveWorkoutProgress("first", initialWorkout());
    setWorkoutOwner(null, true);
    assert.equal(readWorkoutProgress("first"), null);
  } finally {
    Date.now = originalNow;
    setWorkoutOwner(null, true);
  }
});

test("a failed storage write cannot replace newer progress with an old snapshot", () => {
  let raw: string | null = null;
  let blockWrites = false;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: () => raw,
        setItem: (_key: string, value: string) => {
          if (blockWrites) throw new Error("QuotaExceededError");
          raw = value;
        },
        removeItem: () => {
          raw = null;
        },
      },
    },
  });
  try {
    setWorkoutOwner("storage-test", true);
    saveWorkoutProgress("storage-test", initialWorkout());
    blockWrites = true;
    const active = advanceWorkout(demoWorkout, initialWorkout(), {
      type: "start",
      now: Date.now(),
    });
    saveWorkoutProgress("storage-test", active);
    assert.equal(readWorkoutProgress("storage-test")?.phase, "active");
  } finally {
    setWorkoutOwner(null, true);
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("logout cannot resurrect progress when storage deletion fails", () => {
  let raw: string | null = null;
  let blockRemoval = false;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: () => raw,
        setItem: (_key: string, value: string) => {
          raw = value;
        },
        removeItem: () => {
          if (blockRemoval) throw new Error("SecurityError");
          raw = null;
        },
      },
    },
  });
  try {
    setWorkoutOwner("storage-test", true);
    saveWorkoutProgress("storage-test", initialWorkout());
    blockRemoval = true;
    setWorkoutOwner(null, true);
    setWorkoutOwner("storage-test");
    assert.equal(readWorkoutProgress("storage-test"), null);
  } finally {
    blockRemoval = false;
    setWorkoutOwner(null, true);
    Reflect.deleteProperty(globalThis, "window");
  }
});
