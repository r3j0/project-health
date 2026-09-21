import {
  demoWorkout,
  remainingTime,
  resultError,
  type WorkoutState,
} from "./workout.ts";

const key = "modu-workout-demo-v1";
type Saved = {
  owner: string;
  definition: string;
  expiresAt: number;
  state: WorkoutState;
};
let memory: Saved | null = null;
let activeOwner: string | null = null;
function storage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
export function clearWorkoutProgress() {
  memory = null;
  try {
    storage()?.removeItem(key);
  } catch {
    /* Memory remains cleared. */
  }
}
export function setWorkoutOwner(owner: string | null, erase = false) {
  if (erase || (activeOwner && owner && activeOwner !== owner))
    clearWorkoutProgress();
  activeOwner = owner;
  if (owner) readWorkoutProgress(owner);
}
export function readWorkoutProgress(owner: string): WorkoutState | null {
  try {
    let saved: Saved | null = memory;
    try {
      const raw = storage()?.getItem(key);
      if (raw) saved = JSON.parse(raw);
    } catch {
      // Storage can be blocked or malformed. Validate the memory fallback below too.
    }
    if (!saved) return null;
    if (
      saved.owner !== owner ||
      saved.definition !== demoWorkout.id ||
      !Number.isFinite(saved.expiresAt) ||
      saved.expiresAt <= Date.now()
    ) {
      clearWorkoutProgress();
      return null;
    }
    const s = saved.state;
    const step = demoWorkout.steps[s?.index];
    if (
      !s ||
      !step ||
      !["ready", "active", "record", "rest"].includes(s.phase) ||
      s.runningSince !== null ||
      typeof s.draftValue !== "string" ||
      s.draftValue.length > 16 ||
      !Number.isFinite(s.remainingMs) ||
      s.remainingMs < 0 ||
      s.remainingMs > 60000 ||
      typeof s.results !== "object" ||
      !s.results
    )
      return null;
    // Saved results must belong to preceding steps, and every preceding step must exist.
    if (
      Object.keys(s.results).length !== s.index ||
      demoWorkout.steps
        .slice(0, s.index)
        .some(
          (item) =>
            typeof s.results[item.id] !== "string" ||
            resultError(item, s.results[item.id]),
        )
    )
      return null;
    return s;
  } catch {
    return null;
  }
}
export function saveWorkoutProgress(owner: string, state: WorkoutState) {
  if (activeOwner !== owner) return;
  if (state.phase === "complete") {
    clearWorkoutProgress();
    return;
  }
  memory = {
    owner,
    definition: demoWorkout.id,
    expiresAt: Date.now() + 24 * 3600000,
    state: {
      ...state,
      remainingMs: remainingTime(state, Date.now()),
      runningSince: null,
    },
  };
  try {
    storage()?.setItem(key, JSON.stringify(memory));
  } catch {
    /* Preserve this document's progress in memory. */
  }
}
