import {
  interruptedWorkout,
  isWorkoutState,
  type WorkoutState,
} from "./workout.ts";
import { adultAssessment, type AssessmentSetup } from "./assessment.ts";

const key = "modu-workout-session-v2";
export type WorkoutDraft = {
  setup: AssessmentSetup;
  stage: "setup" | "session";
  state: WorkoutState;
  catalogVersion?: string;
  pending: { key: string; body: string } | null;
};
type Saved = { owner: string; expiresAt: number; draft: WorkoutDraft };
let memory: Saved | null | undefined;
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
    try {
      storage()?.setItem(key, "null");
    } catch {
      /* Memory remains cleared. */
    }
  }
}
export function setWorkoutOwner(owner: string | null, erase = false) {
  if (erase || (activeOwner && owner && activeOwner !== owner))
    clearWorkoutProgress();
  activeOwner = owner;
  if (owner) readWorkoutProgress(owner);
}
export function validWorkoutDraft(value: unknown): value is WorkoutDraft {
  if (!value || typeof value !== "object") return false;
  const d = value as WorkoutDraft,
    s = d.setup;
  if (
    !s ||
    !["setup", "session"].includes(d.stage) ||
    !["cross", "curl"].includes(s.endurance) ||
    !["", "male", "female"].includes(s.sex)
  )
    return false;
  if (
    ![s.age, s.height, s.weight, s.waist, s.measuredOn].every(
      (v) => typeof v === "string" && v.length <= 16,
    )
  )
    return false;
  if (
    d.catalogVersion !== undefined &&
    (typeof d.catalogVersion !== "string" || d.catalogVersion.length > 100)
  )
    return false;
  if (!isWorkoutState(d.state, adultAssessment(s.endurance))) return false;
  if (d.pending !== null) {
    if (
      !d.pending ||
      typeof d.pending.key !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(d.pending.key) ||
      typeof d.pending.body !== "string" ||
      d.pending.body.length > 20000 ||
      d.state.phase !== "review" ||
      d.stage !== "session"
    )
      return false;
    try {
      const body = JSON.parse(d.pending.body);
      if (
        body.entryMethod !== "self_assessment" ||
        !Array.isArray(body.items) ||
        !body.items.length ||
        body.catalogVersion !== d.catalogVersion
      )
        return false;
    } catch {
      return false;
    }
  }
  return true;
}
export function readWorkoutProgress(owner: string): WorkoutDraft | null {
  if (activeOwner !== owner) return null;
  if (memory === undefined) {
    try {
      const raw = storage()?.getItem(key);
      memory = raw ? JSON.parse(raw) : null;
    } catch {
      memory = null;
    }
  }
  const saved = memory;
  if (!saved) return null;
  if (
    saved.owner !== owner ||
    !Number.isFinite(saved.expiresAt) ||
    (saved.expiresAt <= Date.now() && !saved.draft?.pending) ||
    !validWorkoutDraft(saved.draft)
  ) {
    clearWorkoutProgress();
    return null;
  }
  return { ...saved.draft, state: interruptedWorkout(saved.draft.state) };
}
export function saveWorkoutProgress(owner: string, draft: WorkoutDraft) {
  if (activeOwner !== owner) return false;
  memory = {
    owner,
    expiresAt: Date.now() + 24 * 3600000,
    draft: { ...draft, state: interruptedWorkout(draft.state) },
  };
  try {
    storage()?.setItem(key, JSON.stringify(memory));
  } catch {
    /* Retain this document's newer state. */
  }
  return true;
}
