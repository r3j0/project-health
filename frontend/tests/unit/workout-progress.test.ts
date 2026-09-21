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
