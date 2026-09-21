"use client";
import { useEffect, useReducer, useState } from "react";
import Link from "next/link";
import { Play, Pause, Timer } from "lucide-react";
import {
  advanceWorkout,
  demoWorkout,
  initialWorkout,
  resultError,
} from "@/lib/workout";
import {
  readWorkoutProgress,
  saveWorkoutProgress,
} from "@/lib/workout-progress";
import { getSession } from "@/lib/session";
import { Dialog, FieldError, Header, Notice, Shell } from "./ui";

export function WorkoutRunner() {
  const [owner] = useState(() => getSession().user!.id);
  const [generation] = useState(() => getSession().generation);
  const [state, dispatch] = useReducer(
    (
      current: ReturnType<typeof initialWorkout>,
      action: Parameters<typeof advanceWorkout>[2],
    ) => advanceWorkout(demoWorkout, current, action),
    undefined,
    () => readWorkoutProgress(owner) ?? initialWorkout(),
  );
  const [error, setError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const step = demoWorkout.steps[state.index];
  useEffect(() => {
    if (getSession().generation === generation)
      saveWorkoutProgress(owner, state);
  }, [owner, generation, state]);
  useEffect(() => {
    if (state.runningSince === null) return;
    const timer = window.setInterval(
      () => dispatch({ type: "tick", now: Date.now() }),
      250,
    );
    const pause = () => {
      if (document.hidden) dispatch({ type: "pause", now: Date.now() });
    };
    document.addEventListener("visibilitychange", pause);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", pause);
    };
  }, [state.runningSince]);
  function record(event: React.FormEvent) {
    event.preventDefault();
    const problem = resultError(step, state.draftValue);
    setError(problem ?? "");
    if (!problem) {
      dispatch({ type: "record", value: state.draftValue });
    }
  }
  const running = state.runningSince !== null;
  const seconds = Math.ceil(state.remainingMs / 1000);
  return (
    <Shell>
      <Header title="간이측정 체험" back="/" />
      <div className="content stack">
        <Notice tone="info">
          진행 방법을 익히는 체험이에요. 입력값은 체력 기록이나 운동 완료로
          저장되지 않아요.
        </Notice>
        {state.phase === "complete" ? (
          <section className="feature-card stack">
            <span className="eyebrow">체험 완료</span>
            <h2>진행 방법을 모두 확인했어요</h2>
            <p className="muted">
              체험은 여기까지예요. 입력한 예시 값으로 체력을 평가하지 않아요.
            </p>
            <Link className="button primary" href="/">
              메인으로 돌아가기
            </Link>
            <button
              className="button secondary"
              onClick={() => dispatch({ type: "reset" })}
            >
              다시 체험하기
            </button>
          </section>
        ) : (
          <>
            <div className="workout-progress">
              <span>
                항목 {state.index + 1} / {demoWorkout.steps.length}
              </span>
              <progress
                aria-label="체험 진행률"
                max={demoWorkout.steps.length}
                value={Object.keys(state.results).length}
              />
            </div>
            <section
              className="feature-card stack"
              aria-labelledby="workout-title"
            >
              <span className="eyebrow">
                {state.phase === "rest"
                  ? "잠시 쉬어가기"
                  : state.phase === "record"
                    ? "결과 입력"
                    : "간이측정 체험"}
              </span>
              <h2 id="workout-title">
                {state.phase === "rest" ? "다음 항목을 준비해요" : step.title}
              </h2>
              <p className="muted">
                {state.phase === "rest"
                  ? `다음은 ${step.title}이에요. 준비되면 바로 넘어가도 괜찮아요.`
                  : step.instruction}
              </p>
              {state.phase === "ready" && (
                <>
                  <p className="caption">
                    예시 진행 시간 {step.durationSeconds}초 · {step.result.unit}{" "}
                    단위 입력
                  </p>
                  <button
                    className="button primary"
                    onClick={() => dispatch({ type: "start", now: Date.now() })}
                  >
                    <Play size={18} />
                    타이머 시작
                  </button>
                </>
              )}
              {(state.phase === "active" || state.phase === "rest") && (
                <>
                  <div
                    className="workout-clock"
                    role="timer"
                    aria-label="남은 시간"
                  >
                    <Timer size={24} />
                    <strong>{seconds}</strong>
                    <span>초</span>
                  </div>
                  <button
                    className="button primary"
                    onClick={() =>
                      dispatch({
                        type: running ? "pause" : "resume",
                        now: Date.now(),
                      })
                    }
                  >
                    {running ? <Pause size={18} /> : <Play size={18} />}
                    {running ? "일시정지" : "계속하기"}
                  </button>
                  <button
                    className="button secondary"
                    onClick={() =>
                      state.phase === "rest"
                        ? dispatch({ type: "next" })
                        : dispatch({ type: "finish", now: Date.now() })
                    }
                  >
                    {state.phase === "rest" ? "다음 항목으로" : "기록 입력으로"}
                  </button>
                </>
              )}
              {state.phase === "record" && (
                <form className="stack" onSubmit={record} noValidate>
                  <div className="field">
                    <label htmlFor="workout-result">
                      {step.result.label} ({step.result.unit})
                    </label>
                    <input
                      id="workout-result"
                      type="text"
                      inputMode={
                        step.result.kind === "count" ? "numeric" : "decimal"
                      }
                      maxLength={16}
                      value={state.draftValue}
                      onChange={(e) =>
                        dispatch({ type: "input", value: e.target.value })
                      }
                      aria-invalid={!!error}
                      aria-describedby="workout-error"
                      autoComplete="off"
                    />
                    <FieldError id="workout-error" message={error} />
                  </div>
                  <button className="button primary">
                    {state.index === demoWorkout.steps.length - 1
                      ? "체험 마치기"
                      : "입력하고 다음으로"}
                  </button>
                </form>
              )}
            </section>
            <p className="caption">
              진행 상황은 이 탭에 임시 보관돼요. 다시 열면 일시정지 상태로
              이어갈 수 있어요.
            </p>
            <div className="button-row">
              <Link className="button secondary" href="/">
                나중에 이어하기
              </Link>
              <button
                className="button secondary"
                onClick={() => {
                  dispatch({ type: "pause", now: Date.now() });
                  setConfirmReset(true);
                }}
              >
                처음부터
              </button>
            </div>
          </>
        )}
      </div>
      {confirmReset && (
        <Dialog
          title="체험을 처음부터 할까요?"
          onClose={() => setConfirmReset(false)}
        >
          <div className="stack">
            <p>현재 체험의 입력과 진행 상황을 지워요.</p>
            <div className="button-row">
              <button
                className="button secondary"
                onClick={() => setConfirmReset(false)}
              >
                취소
              </button>
              <button
                className="button primary"
                onClick={() => {
                  dispatch({ type: "reset" });
                  setError("");
                  setConfirmReset(false);
                }}
              >
                처음부터 시작
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </Shell>
  );
}
