"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus } from "lucide-react";
import { Header, Notice, Shell } from "./ui";
import { RecordForm } from "./record-form";
import { useOperationScope } from "./use-operation-scope";
import { api, getSession } from "@/lib/session";
import { ApiError, errorMessage } from "@/lib/http";
import { measurementDrafts } from "@/lib/measurement-drafts";
import {
  canReviewExtraction,
  extractionSeed,
  extractionStatusText,
  parseExtraction,
  type ExtractionDraft,
} from "@/lib/extraction";

type Photo = { file: File; url: string; width: number; height: number };
const extractionErrors: Record<string, string> = {
  EXTRACTION_UNAVAILABLE:
    "사진 분석을 아직 사용할 수 없어요. 결과표를 보며 직접 입력할 수 있어요.",
  EXTRACTION_TIMEOUT:
    "사진 분석 시간이 초과됐어요. 다시 시도하거나 직접 입력해 주세요.",
  IMAGE_TOO_LARGE: "10MB 이하의 사진을 선택해 주세요.",
  IMAGE_DIMENSIONS_EXCEEDED:
    "사진 해상도가 너무 높아요. 크기를 줄인 사진을 선택해 주세요.",
  INVALID_IMAGE: "손상된 사진이에요. 다른 사진을 선택해 주세요.",
  UNSUPPORTED_IMAGE: "JPG, PNG, WEBP 사진을 선택해 주세요.",
  OPENAI_REFUSAL:
    "이 사진을 분석할 수 없어요. 다른 사진을 선택하거나 직접 입력해 주세요.",
};
export function ReportPhoto() {
  const [resume] = useState(
    () => !!measurementDrafts.read(getSession().user!.id, "photo"),
  );
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [draft, setDraft] = useState<ExtractionDraft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"image" | "extract" | null>(null);
  const [entering, setEntering] = useState(resume);
  const [cooldown, setCooldown] = useState(0);
  const controller = useRef<AbortController | null>(null),
    guard = useRef(false);
  const beginOperation = useOperationScope();
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.url);
    },
    [photo],
  );
  useEffect(() => {
    if (!cooldown) return;
    const timer = setInterval(() => {
      if (Date.now() >= cooldown) setCooldown(0);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);
  async function select(file: File | undefined) {
    if (!file) return;
    controller.current?.abort();
    guard.current = false;
    const isCurrent = beginOperation();
    setError("");
    setDraft(null);
    setPhoto(null);
    setBusy(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("JPG, PNG, WEBP 사진을 선택해 주세요.");
      return;
    }
    if (!file.size || file.size > 10 * 1024 * 1024) {
      setError("0바이트보다 크고 10MB 이하인 사진을 선택해 주세요.");
      return;
    }
    setBusy("image");
    const url = URL.createObjectURL(file);
    try {
      const decoded = new window.Image();
      decoded.src = url;
      await decoded.decode();
      if (!isCurrent()) {
        URL.revokeObjectURL(url);
        return;
      }
      setPhoto({
        file,
        url,
        width: decoded.naturalWidth,
        height: decoded.naturalHeight,
      });
    } catch {
      URL.revokeObjectURL(url);
      if (isCurrent())
        setError("사진을 읽을 수 없어요. 다른 사진을 선택해 주세요.");
    } finally {
      if (isCurrent()) setBusy(null);
    }
  }
  async function extract() {
    if (!photo || guard.current || busy || cooldown) return;
    guard.current = true;
    const isCurrent = beginOperation(),
      abort = new AbortController();
    controller.current = abort;
    setBusy("extract");
    setError("");
    setDraft(null);
    const form = new FormData();
    form.append("image", photo.file);
    try {
      const response = await api<unknown>("/measurements/extract", {
        method: "POST",
        body: form,
        signal: abort.signal,
        timeoutMs: 50000,
      });
      if (isCurrent()) setDraft(parseExtraction(response.data));
    } catch (cause) {
      if (!isCurrent() || abort.signal.aborted) return;
      setError(
        cause instanceof ApiError
          ? (extractionErrors[cause.code ?? ""] ??
              (cause.status === 404
                ? extractionErrors.EXTRACTION_UNAVAILABLE
                : errorMessage(cause)))
          : errorMessage(cause),
      );
      if (cause instanceof ApiError && cause.status === 429 && cause.retryAfter)
        setCooldown(Date.now() + cause.retryAfter * 1000);
    } finally {
      if (isCurrent()) {
        setBusy(null);
        guard.current = false;
      }
    }
  }
  function cancel() {
    controller.current?.abort();
    beginOperation();
    guard.current = false;
    setBusy(null);
    setError("사진 분석을 취소했어요.");
  }
  const preview = photo ? (
    <details className="accordion">
      <summary>선택한 결과표 보기</summary>
      <Image
        className="report-preview"
        src={photo.url}
        alt="선택한 국민체력100 결과표"
        width={photo.width}
        height={photo.height}
        unoptimized
      />
      <p className="caption photo-name">{photo.file.name}</p>
    </details>
  ) : null;
  if (entering)
    return (
      <RecordForm
        onboarding
        draftKey="photo"
        seed={
          draft && canReviewExtraction(draft)
            ? extractionSeed(draft)
            : undefined
        }
        reference={
          <div className="stack" style={{ marginBottom: 20 }}>
            {preview}
            <Notice tone="info">
              사진에서 읽은 값은 틀릴 수 있어요. 실제 결과표와 비교하고 기본
              정보·측정값을 확인한 뒤 저장해 주세요.
            </Notice>
          </div>
        }
      />
    );
  return (
    <Shell>
      <Header title="결과표 사진 선택" back="/onboarding" />
      <div className="content stack">
        <div className="intro">
          <h2>결과표가 잘 보이게 선택해 주세요</h2>
          <p>측정값과 단위가 선명하게 보이는 사진이 좋아요.</p>
        </div>
        <div className="button-row">
          {[
            ["사진 촬영", "결과표 촬영", true],
            ["사진 선택", "결과표 파일 선택", false],
          ].map(([label, aria, capture]) => (
            <label className="button secondary file-button" key={String(label)}>
              {capture ? <Camera size={18} /> : <ImagePlus size={18} />}
              {label}
              <input
                aria-label={String(aria)}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture={capture ? "environment" : undefined}
                disabled={!!busy}
                onChange={(event) => {
                  void select(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
          ))}
        </div>
        <p className="caption">
          JPG, PNG, WEBP · 최대 10MB. 사진 분석을 요청하면 OpenAI에 사진이
          전송됩니다.
        </p>
        {busy && (
          <Notice tone="info">
            {busy === "extract"
              ? "측정값을 분석하고 있어요. 잠시만 기다려 주세요."
              : "사진을 확인하고 있어요."}
          </Notice>
        )}
        {error && <Notice>{error}</Notice>}
        {!!cooldown && (
          <p role="status" className="caption">
            요청 제한 시간이 지나면 사진 분석을 다시 시도할 수 있어요.
          </p>
        )}
        {preview}
        {photo && (
          <>
            <button
              className="button primary"
              disabled={!!busy || !!cooldown}
              onClick={() => void extract()}
            >
              {draft ? "사진 다시 분석" : "사진에서 측정값 읽기"}
            </button>
            {busy === "extract" && (
              <button className="button secondary" onClick={cancel}>
                분석 취소
              </button>
            )}
            {draft && (
              <section className="feature-card stack">
                <Notice tone="info">
                  {extractionStatusText[draft.status]}
                </Notice>
                {canReviewExtraction(draft) && (
                  <>
                    <p>
                      읽은 측정값 {draft.items.length}개 · 확인할 항목{" "}
                      {draft.reviewItems.length}개
                    </p>
                    <button
                      className="button primary"
                      onClick={() => setEntering(true)}
                    >
                      추출값 확인·수정
                    </button>
                  </>
                )}
              </section>
            )}
            <button
              className="text-button"
              disabled={!!busy}
              onClick={() => {
                setDraft(null);
                setEntering(true);
              }}
            >
              이 사진을 보며 직접 입력
            </button>
            <button
              className="text-button"
              disabled={!!busy}
              onClick={() => {
                setPhoto(null);
                setDraft(null);
                setError("");
              }}
            >
              사진 지우기
            </button>
          </>
        )}
        <Link className="text-link" href="/onboarding/manual">
          사진 없이 직접 입력하기
        </Link>
      </div>
    </Shell>
  );
}
