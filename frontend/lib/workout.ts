export type WorkoutStep = {
  id: string;
  title: string;
  instruction: string;
  durationSeconds: number;
  restSeconds: number;
  result: { kind: "count" | "seconds"; label: string; unit: string };
};
export type WorkoutDefinition = {
  id: string;
  title: string;
  steps: WorkoutStep[];
};
export type WorkoutState = {
  phase: "ready" | "active" | "record" | "rest" | "complete";
  index: number;
  remainingMs: number;
  runningSince: number | null;
  results: Record<string, string>;
  draftValue: string;
};
export type WorkoutAction =
  | { type: "start" | "pause" | "resume" | "tick" | "finish"; now: number }
  | { type: "record" | "input"; value: string }
  | { type: "next" | "reset" };

// Explicit demonstration content; this is neither an assessment protocol nor a recommendation.
export const demoWorkout: WorkoutDefinition = {
  id: "simple-assessment-demo-v1",
  title: "간이측정 체험",
  steps: [
    {
      id: "count",
      title: "횟수 측정 연습",
      instruction:
        "동작 안내를 읽고 타이머를 시작하는 단계예요. 이번 체험에서는 운동 없이 진행 방법을 확인하고 예시 횟수를 입력해 보세요.",
      durationSeconds: 10,
      restSeconds: 5,
      result: { kind: "count", label: "예시 횟수", unit: "회" },
    },
    {
      id: "time",
      title: "시간 측정 연습",
      instruction:
        "시간으로 기록하는 항목도 같은 흐름으로 진행해요. 타이머를 확인한 뒤 예시 시간을 입력해 보세요.",
      durationSeconds: 10,
      restSeconds: 0,
      result: { kind: "seconds", label: "예시 시간", unit: "초" },
    },
  ],
};
export const initialWorkout = (): WorkoutState => ({
  phase: "ready",
  index: 0,
  remainingMs: 0,
  runningSince: null,
  results: {},
  draftValue: "",
});
export function remainingTime(state: WorkoutState, now: number) {
  return Math.max(
    0,
    state.remainingMs -
      (state.runningSince === null ? 0 : Math.max(0, now - state.runningSince)),
  );
}
export function resultError(step: WorkoutStep, value: string) {
  if (!value) return "값을 입력해 주세요. 0도 입력할 수 있어요.";
  const pattern =
    step.result.kind === "count" ? /^(0|[1-9]\d*)$/ : /^(0|[1-9]\d*)(\.\d+)?$/;
  if (value.length > 16 || !pattern.test(value))
    return step.result.kind === "count"
      ? "0 이상의 정수를 입력해 주세요."
      : "0 이상의 숫자를 입력해 주세요.";
  return null;
}
export function advanceWorkout(
  definition: WorkoutDefinition,
  state: WorkoutState,
  action: WorkoutAction,
): WorkoutState {
  const step = definition.steps[state.index];
  if (action.type === "reset") return initialWorkout();
  if (!step || state.phase === "complete") return state;
  switch (action.type) {
    case "start":
      return state.phase === "ready"
        ? {
            ...state,
            phase: "active",
            remainingMs: step.durationSeconds * 1000,
            runningSince: action.now,
          }
        : state;
    case "pause":
      return state.runningSince !== null
        ? {
            ...state,
            remainingMs: remainingTime(state, action.now),
            runningSince: null,
          }
        : state;
    case "resume":
      return (state.phase === "active" || state.phase === "rest") &&
        state.runningSince === null
        ? { ...state, runningSince: action.now }
        : state;
    case "tick": {
      if (state.runningSince === null) return state;
      const remainingMs = remainingTime(state, action.now);
      return remainingMs === 0
        ? {
            ...state,
            phase: state.phase === "rest" ? "ready" : "record",
            remainingMs: 0,
            runningSince: null,
          }
        : { ...state, remainingMs, runningSince: action.now };
    }
    case "finish":
      return state.phase === "active"
        ? { ...state, phase: "record", remainingMs: 0, runningSince: null }
        : state;
    case "input":
      return state.phase === "record"
        ? { ...state, draftValue: action.value }
        : state;
    case "record": {
      if (state.phase !== "record" || resultError(step, action.value))
        return state;
      const results = { ...state.results, [step.id]: action.value };
      if (state.index === definition.steps.length - 1)
        return { ...state, phase: "complete", results };
      return {
        ...state,
        index: state.index + 1,
        results,
        draftValue: "",
        phase: step.restSeconds > 0 ? "rest" : "ready",
        remainingMs: step.restSeconds * 1000,
        runningSince: null,
      };
    }
    case "next":
      return state.phase === "rest"
        ? { ...state, phase: "ready", remainingMs: 0, runningSince: null }
        : state;
  }
}
