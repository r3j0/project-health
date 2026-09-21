import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceWorkout,
  demoWorkout,
  initialWorkout,
  remainingTime,
  resultError,
} from "../../lib/workout.ts";

test("elapsed time survives late timer callbacks and pause/resume", () => {
  let state = advanceWorkout(demoWorkout, initialWorkout(), {
    type: "start",
    now: 1000,
  });
  state = advanceWorkout(demoWorkout, state, { type: "pause", now: 4500 });
  assert.equal(state.remainingMs, 6500);
  assert.equal(remainingTime(state, 90000), 6500);
  state = advanceWorkout(demoWorkout, state, { type: "resume", now: 90000 });
  state = advanceWorkout(demoWorkout, state, { type: "tick", now: 97000 });
  assert.equal(state.phase, "record");
  assert.equal(state.remainingMs, 0);
  assert.equal(state.runningSince, null);
});

test("recording requires the correct phase and valid data; completion cannot repeat", () => {
  let state = initialWorkout();
  assert.equal(
    advanceWorkout(demoWorkout, state, { type: "record", value: "5" }),
    state,
  );
  state = advanceWorkout(demoWorkout, state, { type: "start", now: 0 });
  state = advanceWorkout(demoWorkout, state, { type: "finish", now: 500 });
  assert.equal(
    advanceWorkout(demoWorkout, state, { type: "record", value: "" }),
    state,
  );
  state = advanceWorkout(demoWorkout, state, { type: "record", value: "0" });
  assert.equal(state.phase, "rest");
  assert.equal(state.results.count, "0");
  const duplicate = advanceWorkout(demoWorkout, state, {
    type: "record",
    value: "5",
  });
  assert.equal(duplicate, state);
  state = advanceWorkout(demoWorkout, state, { type: "resume", now: 1000 });
  state = advanceWorkout(demoWorkout, state, { type: "tick", now: 6000 });
  assert.equal(state.phase, "ready");
  assert.equal(state.index, 1);
  state = advanceWorkout(demoWorkout, state, { type: "start", now: 6000 });
  state = advanceWorkout(demoWorkout, state, { type: "finish", now: 6100 });
  state = advanceWorkout(demoWorkout, state, {
    type: "record",
    value: "1.250",
  });
  assert.equal(state.phase, "complete");
  assert.equal(state.results.time, "1.250");
  assert.equal(
    advanceWorkout(demoWorkout, state, { type: "record", value: "9" }),
    state,
  );
  assert.deepEqual(
    advanceWorkout(demoWorkout, state, { type: "reset" }),
    initialWorkout(),
  );
});

test("result validation separates missing, zero, integer and decimal values", () => {
  for (const value of ["", "-1", "1e3", "NaN", "Infinity", "0.5"])
    assert.ok(resultError(demoWorkout.steps[0], value));
  assert.equal(resultError(demoWorkout.steps[0], "0"), null);
  assert.equal(resultError(demoWorkout.steps[1], "0.125"), null);
});
