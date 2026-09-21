"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Camera, ImagePlus } from "lucide-react";
import { Header, Notice, Shell } from "./ui";
import { RecordForm } from "./record-form";
import { useOperationScope } from "./use-operation-scope";

type Photo = { url: string; name: string; width: number; height: number };
export function ReportPhoto() {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [entering, setEntering] = useState(false);
  const beginOperation = useOperationScope();
  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.url);
    },
    [photo],
  );
  async function select(file: File | undefined) {
    if (!file) return;
    const isCurrent = beginOperation();
    setError("");
    setBusy(false);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("JPG, PNG, WEBP 사진을 선택해 주세요.");
      return;
    }
    if (!file.size || file.size > 10 * 1024 * 1024) {
      setError("0바이트보다 크고 10MB 이하인 사진을 선택해 주세요.");
      return;
    }
    setBusy(true);
    const url = URL.createObjectURL(file);
    try {
      const image = new window.Image();
      image.src = url;
      await image.decode();
      if (!isCurrent()) {
        URL.revokeObjectURL(url);
        return;
      }
      setPhoto({
        url,
        name: file.name,
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    } catch {
      URL.revokeObjectURL(url);
      if (isCurrent())
        setError("사진을 읽을 수 없어요. 다른 사진을 선택해 주세요.");
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }
  const preview = photo ? (
    <details className="accordion" open>
      <summary>선택한 결과표 보기</summary>
      <Image
        className="report-preview"
        src={photo.url}
        alt="선택한 국민체력100 결과표"
        width={photo.width}
        height={photo.height}
        unoptimized
      />
      <p className="caption photo-name">{photo.name}</p>
    </details>
  ) : null;
  if (entering) return <RecordForm onboarding reference={preview} />;
  return (
    <Shell>
      <Header title="결과표 사진 선택" back="/onboarding" />
      <div className="content stack">
        <div className="intro">
          <h2>결과표가 잘 보이게 선택해 주세요</h2>
          <p>측정값과 단위가 선명하게 보이는 사진이 좋아요.</p>
        </div>
        <Notice tone="info">
          사진 자동 입력은 준비 중이에요. 지금은 사진을 보면서 직접 입력할 수
          있어요.
        </Notice>
        <div className="button-row">
          <label className="button secondary file-button">
            <Camera size={18} />
            사진 촬영
            <input
              aria-label="결과표 촬영"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              disabled={busy}
              onChange={(e) => {
                void select(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <label className="button secondary file-button">
            <ImagePlus size={18} />
            사진 선택
            <input
              aria-label="결과표 파일 선택"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => {
                void select(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <p className="caption">
          JPG, PNG, WEBP · 최대 10MB. 사진은 업로드하거나 저장하지 않아요.
        </p>
        {busy && <Notice tone="info">사진을 확인하고 있어요.</Notice>}
        {error && <Notice>{error}</Notice>}
        {preview}
        {photo && (
          <>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => setEntering(true)}
            >
              이 사진을 보며 직접 입력
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setPhoto(null)}
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
