"use client";
import Link from "next/link";
import { Camera, ClipboardPen, ChevronRight, Timer } from "lucide-react";
import { Header, Notice, Shell } from "./ui";
import { useUserProfile } from "./user-profile-provider";

export function Onboarding() {
  const profile = useUserProfile();
  return (
    <Shell>
      <Header title="체력 기록 시작하기" back="/" />
      <div className="content stack">
        <div className="intro">
          <span className="eyebrow">내 몸을 알아가는 첫걸음</span>
          <h2>어떤 방법으로 시작할까요?</h2>
          <p>국민체력100 결과표가 있다면 측정한 항목부터 등록해 주세요.</p>
        </div>
        {profile.data?.isOnboarded && (
          <Notice tone="info">
            이미 등록한 기록이 있어요. 새로운 측정 결과를 추가할 수 있어요.
          </Notice>
        )}
        <Link href="/onboarding/photo" className="choice-card">
          <Camera size={24} />
          <div>
            <h3>결과표 사진 선택</h3>
            <p>사진을 보면서 직접 입력할 수 있어요.</p>
            <span className="caption">자동 입력은 준비 중이에요</span>
          </div>
          <ChevronRight size={20} />
        </Link>
        <Link href="/onboarding/manual" className="choice-card">
          <ClipboardPen size={24} />
          <div>
            <h3>결과 직접 입력</h3>
            <p>측정한 항목 하나부터 등록해요.</p>
          </div>
          <ChevronRight size={20} />
        </Link>
        <section className="feature-card stack">
          <Timer size={24} />
          <h2>결과표가 아직 없나요?</h2>
          <p className="muted">
            간이측정 체험에서 안내, 타이머, 결과 입력 방법을 먼저 확인해 보세요.
          </p>
          <Link href="/workout" className="button secondary">
            간이측정 체험하기
          </Link>
          <p className="caption">
            체험은 실제 체력 평가나 측정 기록 등록으로 처리되지 않아요.
          </p>
        </section>
        <Link href="/" className="text-link">
          나중에 등록하기
        </Link>
        <Link href="/measurements" className="text-link">
          내 측정 기록 보기
        </Link>
      </div>
    </Shell>
  );
}
