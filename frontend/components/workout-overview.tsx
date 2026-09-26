"use client";
import Link from "next/link";
import { useUserProfile } from "./user-profile-provider";
import { Header, Loading, Notice, Shell } from "./ui";
import { assessmentHref } from "@/lib/workout-mode";
export function WorkoutOverview({
  unsupported = false,
}: {
  unsupported?: boolean;
}) {
  const profile = useUserProfile();
  const assignment = profile.data?.currentCurriculum;
  return (
    <Shell>
      <Header title="운동" />
      <div className="content stack">
        {unsupported ? (
          <>
            <Notice>지원하지 않는 운동 과정이에요.</Notice>
            <Link className="button secondary" href={assessmentHref}>
              성인 간이측정 열기
            </Link>
          </>
        ) : (
          <>
            {profile.status === "loading" && <Loading />}
            {profile.error && (
              <>
                <Notice>{profile.error}</Notice>
                <button className="button secondary" onClick={profile.reload}>
                  다시 불러오기
                </button>
              </>
            )}
            {profile.data && (
              <section className="curriculum-card stack">
                <h2>
                  {assignment?.curriculum.name ?? "아직 배정된 운동이 없어요"}
                </h2>
                {assignment && (
                  <span className="status-badge">
                    {assignment.status === "completed" ? "완료" : "배정됨"}
                  </span>
                )}
                {assignment?.status === "assigned" && (
                  <p className="muted">
                    배정된 운동의 상세 안내를 준비하고 있어요.
                  </p>
                )}
              </section>
            )}
          </>
        )}
        <Link className="text-link" href="/onboarding">
          체력 기록 시작하기
        </Link>
      </div>
    </Shell>
  );
}
