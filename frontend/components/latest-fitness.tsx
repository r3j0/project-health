"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, invalidateUserProfile } from "@/lib/session";
import { ApiError, errorMessage } from "@/lib/http";
import {
  latestFitnessPath,
  parseLatestFitness,
  type LatestFitnessProfile,
} from "@/lib/fitness-evaluation";
import { displayDate } from "@/lib/measurements";
import { FitnessRadar } from "./fitness-radar";
import { useSession } from "./session-provider";
import { Loading, Notice } from "./ui";

type State =
  | { status: "ready"; data: LatestFitnessProfile | null }
  | { status: "error" | "unavailable"; error: string };
export function LatestFitness() {
  const session = useSession();
  const version = `${session.generation}:${session.profileRevision}`;
  const [snapshot, setSnapshot] = useState<{
    version: string;
    state: State;
  } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    api<unknown>(latestFitnessPath, { signal: abort.signal })
      .then(({ data }) => {
        const profile = parseLatestFitness(data);
        if (!abort.signal.aborted)
          setSnapshot({ version, state: { status: "ready", data: profile } });
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setSnapshot({
            version,
            state:
              error instanceof ApiError && [404, 501].includes(error.status)
                ? {
                    status: "unavailable",
                    error:
                      "체력 프로필을 준비 중이에요. 등록한 기록은 계속 확인할 수 있어요.",
                  }
                : { status: "error", error: errorMessage(error) },
          });
      });
    return () => abort.abort();
  }, [version]);
  const state = snapshot?.version === version ? snapshot.state : null;
  return (
    <section
      className="stack latest-fitness"
      aria-labelledby="latest-fitness-title"
    >
      <h2 id="latest-fitness-title">나의 체력 프로필</h2>
      {!state ? (
        <Loading label="최근 체력 프로필을 확인하고 있어요" />
      ) : state.status !== "ready" ? (
        <>
          <Notice tone={state.status === "unavailable" ? "info" : "error"}>
            {state.error}
          </Notice>
          <button
            className="text-button"
            onClick={() => invalidateUserProfile()}
          >
            체력 프로필 다시 확인
          </button>
        </>
      ) : state.data === null ? (
        <p className="muted">아직 등록한 측정 기록이 없어요.</p>
      ) : (
        <>
          <p className="caption">
            {displayDate(state.data.measurement.measuredOn)} · 최신 측정 기록
            기준
          </p>
          {state.data.evaluation ? (
            <FitnessRadar axes={state.data.evaluation.axes} />
          ) : (
            <Notice tone="info">
              이 기록의 평가 결과는 아직 제공되지 않았어요.
            </Notice>
          )}
          <Link
            className="text-link"
            href={`/measurements/${state.data.measurement.id}`}
          >
            이 기록의 상세 리포트 보기
          </Link>
        </>
      )}
    </section>
  );
}
