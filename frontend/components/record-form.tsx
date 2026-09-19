"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CircleMinus, Plus } from "lucide-react";
import { ApiError, errorMessage } from "@/lib/http";
import { api } from "@/lib/session";
import { getCatalog, getRecord, koreaDate } from "@/lib/measurements";
import {
  buildInput,
  emptyMetadata,
  metadataFrom,
  validateMetadata,
  type FormItem,
  type FormMetadata,
} from "@/lib/measurement-form";
import type { Catalog, Measurement, RecordResponse } from "@/lib/types";
import { Dialog, FieldError, Header, Notice, Shell, SubmitLabel } from "./ui";
import { CatalogPicker } from "./catalog-picker";
import { RecordValues } from "./record-values";
import { useUnsaved } from "./use-unsaved";
export function RecordForm({
  initial,
  initialCatalog,
}: {
  initial?: RecordResponse;
  initialCatalog?: Catalog;
}) {
  const router = useRouter();
  const [base, setBase] = useState(initial),
    [meta, setMeta] = useState<FormMetadata>(
      initial ? metadataFrom(initial.data) : { ...emptyMetadata },
    );
  const [items, setItems] = useState<FormItem[]>(
    initial
      ? initial.data.items.map((i) => ({
          code: i.measurementCode,
          value: i.value,
          grade: i.reportedGrade ?? "",
        }))
      : [],
  );
  const [catalog, setCatalog] = useState(initialCatalog),
    [step, setStep] = useState(initial ? 2 : 1),
    [picker, setPicker] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({}),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  const [uncertain, setUncertain] = useState(false),
    [gone, setGone] = useState(false),
    [latest, setLatest] = useState<RecordResponse | null>(null),
    [conflict, setConflict] = useState(false);
  const pending = useRef<{ body: string; key: string } | null>(null),
    guard = useRef(false),
    notice = useRef<HTMLDivElement>(null);
  const savedRef = useUnsaved(dirty || uncertain);
  const locked = busy || uncertain || gone;
  const validItems = items.filter((i) => i.value !== "");
  function update<K extends keyof FormMetadata>(
    key: K,
    value: FormMetadata[K],
  ) {
    setMeta((m) => ({ ...m, [key]: value }));
    setDirty(true);
  }
  function updateItem(code: string, key: "value" | "grade", value: string) {
    setItems((current) =>
      current.map((i) => (i.code === code ? { ...i, [key]: value } : i)),
    );
    setDirty(true);
  }
  function scrollError() {
    setTimeout(() => {
      notice.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      notice.current?.focus();
    }, 0);
  }
  async function advance(event: React.FormEvent) {
    event.preventDefault();
    if (guard.current) return;
    const next = validateMetadata(meta, koreaDate());
    setErrors(next);
    setMessage("");
    if (Object.keys(next).length) {
      setMessage("기본 정보를 확인해 주세요.");
      scrollError();
      return;
    }
    guard.current = true;
    setBusy(true);
    try {
      if (!catalog) setCatalog(await getCatalog(base?.data.catalogVersion));
      setStep(2);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setMessage(errorMessage(e));
      scrollError();
    } finally {
      setBusy(false);
      guard.current = false;
    }
  }
  async function readLatest() {
    setBusy(true);
    try {
      const value = await getRecord(base!.data.id);
      setLatest(value);
      setConflict(true);
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (guard.current || !catalog || gone) return;
    const built = buildInput(meta, items, catalog, koreaDate());
    setErrors(built.errors);
    setMessage("");
    if (Object.keys(built.errors).length) {
      setMessage("입력한 항목을 확인해 주세요.");
      scrollError();
      return;
    }
    const patch = { ...built.input };
    if (base) Reflect.deleteProperty(patch, "catalogVersion");
    const body = JSON.stringify(base ? patch : built.input);
    if (
      !base &&
      (!pending.current || (!uncertain && pending.current.body !== body))
    )
      pending.current = { body, key: crypto.randomUUID() };
    guard.current = true;
    setBusy(true);
    try {
      const result = await api<Measurement>(
        base ? `/measurements/${base.data.id}` : "/measurements",
        {
          method: base ? "PATCH" : "POST",
          body: !base ? pending.current!.body : body,
          headers: base
            ? { "If-Match": base.etag }
            : { "Idempotency-Key": pending.current!.key },
        },
      );
      if (!result.data?.id)
        throw new ApiError(
          0,
          "저장 결과를 확인하지 못했어요. 다시 확인해 주세요.",
        );
      savedRef.current = true;
      setDirty(false);
      setUncertain(false);
      router.replace(`/measurements/${result.data.id}?saved=1`);
    } catch (e) {
      setMessage(errorMessage(e));
      if (e instanceof ApiError) {
        if (e.status === 0 || e.status >= 500) setUncertain(true);
        else {
          setUncertain(false);
          if (e.status === 410 || e.status === 404) setGone(true);
          if (e.status === 412 && base) {
            setConflict(true);
            getRecord(base.data.id)
              .then(setLatest)
              .catch((error) => setMessage(errorMessage(error)));
          }
          const fields: Record<string, string> = {};
          for (const [field, text] of Object.entries(e.fields)) {
            const match = /^items\.(\d+)\.(.+)$/.exec(field);
            if (match) {
              const code = built.input.items[Number(match[1])]?.measurementCode;
              if (code)
                fields[
                  `${match[2] === "reportedGrade" ? "grade" : "item"}.${code}`
                ] = text;
            } else fields[field] = text;
          }
          if (Object.keys(fields).length) {
            setErrors(fields);
            if (
              Object.keys(fields).some((k) =>
                [
                  "measuredOn",
                  "ageAtMeasurement",
                  "sexAtMeasurement",
                  "reportKind",
                  "centerName",
                  "reportedOverallGrade",
                ].includes(k),
              )
            )
              setStep(1);
          }
        }
      }
      scrollError();
    } finally {
      setBusy(false);
      guard.current = false;
    }
  }
  function useLatest() {
    if (!latest) return;
    if (
      !window.confirm(
        "작성 중인 입력을 최신 기록으로 바꿉니다. 최신 기록으로 다시 편집할까요?",
      )
    )
      return;
    setBase(latest);
    setMeta(metadataFrom(latest.data));
    setItems(
      latest.data.items.map((i) => ({
        code: i.measurementCode,
        value: i.value,
        grade: i.reportedGrade ?? "",
      })),
    );
    setLatest(null);
    setConflict(false);
    setMessage("");
    setErrors({});
    setDirty(false);
    setUncertain(false);
  }
  const textField = (
    id: string,
    label: string,
    key: "center" | "grade",
    max: number,
    field: string,
  ) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={meta[key]}
        maxLength={max}
        onChange={(e) => update(key, e.target.value)}
        aria-invalid={!!errors[field]}
      />
      <FieldError message={errors[field]} />
    </div>
  );
  return (
    <Shell>
      <Header
        title={
          base ? "측정 기록 수정" : step === 1 ? "새 측정 기록" : "측정값 입력"
        }
        back={base ? `/measurements/${base.data.id}` : "/measurements"}
      />
      <div className="content">
        <div className="stepper" aria-label={`${step}단계 / 2단계`}>
          <span className={`step ${step === 1 ? "active" : ""}`}>
            <b>1</b>기본 정보
          </span>
          <span className="step-line" />
          <span className={`step ${step === 2 ? "active" : ""}`}>
            <b>2</b>측정값
          </span>
        </div>
        <div
          ref={notice}
          tabIndex={-1}
          className={message ? "stack-sm" : ""}
          style={message ? { marginBottom: 20 } : undefined}
        >
          {message && <Notice>{message}</Notice>}
          {uncertain && (
            <Notice tone="info">
              저장 결과를 아직 확인하지 못했어요. 중복 등록을 막기 위해 같은
              내용으로 다시 확인해 주세요. 확인 전까지 입력은 잠시 잠겨요.
            </Notice>
          )}
          {gone && (
            <Link className="text-link" href="/measurements">
              기록 목록으로 이동
            </Link>
          )}
        </div>
        {step === 1 ? (
          <form onSubmit={advance} className="metadata-form">
            <div className="intro">
              <h2>언제 측정하셨나요?</h2>
              <p>결과표의 정보를 입력해 주세요.</p>
            </div>
            <fieldset disabled={locked} className="stack">
              <div className="field">
                <label htmlFor="measuredOn">측정일</label>
                <input
                  id="measuredOn"
                  type="date"
                  required
                  value={meta.measuredOn}
                  max={koreaDate()}
                  onChange={(e) => update("measuredOn", e.target.value)}
                  aria-invalid={!!errors.measuredOn}
                  aria-describedby="measuredOn-error"
                />
                <FieldError id="measuredOn-error" message={errors.measuredOn} />
              </div>
              <div className="field">
                <label htmlFor="age">측정 당시 만 나이</label>
                <div className="input-wrap">
                  <input
                    id="age"
                    inputMode="numeric"
                    pattern="[0-9]{1,2}"
                    maxLength={2}
                    required
                    value={meta.age}
                    onChange={(e) => update("age", e.target.value)}
                    placeholder="예: 25"
                    aria-invalid={!!errors.ageAtMeasurement}
                    aria-describedby="age-hint age-error"
                  />
                  <span className="input-unit">세</span>
                </div>
                <p className="caption" id="age-hint">
                  만 13~64세의 기록을 등록할 수 있어요.
                </p>
                <FieldError id="age-error" message={errors.ageAtMeasurement} />
              </div>
              <details className="accordion">
                <summary>
                  추가 정보 <span className="optional-label">(선택)</span>
                </summary>
                <p className="caption summary-hint">
                  성별 · 측정 유형 · 센터 · 결과표 종합등급
                </p>
                <div className="stack">
                  <div className="field">
                    <label htmlFor="sex">결과표의 성별</label>
                    <select
                      id="sex"
                      value={meta.sex}
                      onChange={(e) => update("sex", e.target.value)}
                    >
                      <option value="">선택 안 함</option>
                      <option value="male">남성</option>
                      <option value="female">여성</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="kind">측정 유형</label>
                    <select
                      id="kind"
                      value={meta.kind}
                      onChange={(e) =>
                        update("kind", e.target.value as FormMetadata["kind"])
                      }
                    >
                      <option value="unknown">모름 / 선택 안 함</option>
                      <option value="standard">일반 체력측정</option>
                      <option value="simple">공식 간편측정</option>
                    </select>
                  </div>
                  {textField(
                    "center",
                    "측정 센터",
                    "center",
                    200,
                    "centerName",
                  )}
                  {textField(
                    "grade",
                    "결과표 종합등급",
                    "grade",
                    100,
                    "reportedOverallGrade",
                  )}
                  <p className="caption">
                    결과표에 적힌 그대로 입력해 주세요. 서비스가 계산한 등급이
                    아니에요.
                  </p>
                </div>
              </details>
            </fieldset>
            <div className="sticky-actions">
              <p className="caption center">
                나이에 맞는 검사 항목을 보여드려요.
              </p>
              <button className="button primary" disabled={locked}>
                <SubmitLabel busy={busy}>
                  {busy ? "검사 항목 확인 중" : "측정값 입력하기"}
                </SubmitLabel>
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={submit}>
            <div className="summary-strip">
              <span>
                {meta.measuredOn.replaceAll("-", ".")} · 만 {meta.age}세
              </span>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setStep(1);
                  setMessage("");
                }}
                disabled={locked}
              >
                변경
              </button>
            </div>
            <div className="intro">
              <h2>측정한 항목만 입력해요</h2>
              <p>하나만 입력해도 저장할 수 있어요.</p>
            </div>
            <fieldset disabled={locked} className="stack">
              {!items.length && (
                <Notice tone="info">
                  아래 버튼을 눌러 결과표에 있는 항목을 추가해 주세요.
                </Notice>
              )}
              <div className="form-items">
                {items.map((item) => {
                  const definition = catalog?.definitions.find(
                      (d) => d.code === item.code,
                    ),
                    label = definition?.label ?? item.code;
                  return (
                    <div key={item.code} className="measurement-field">
                      <div className="between">
                        <label htmlFor={`value-${item.code}`}>{label}</label>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`${label} 항목 삭제`}
                          onClick={() => {
                            if (
                              (item.value || item.grade) &&
                              !window.confirm(`${label}의 입력값을 삭제할까요?`)
                            )
                              return;
                            setItems((old) =>
                              old.filter((i) => i.code !== item.code),
                            );
                            setDirty(true);
                          }}
                        >
                          <CircleMinus size={20} />
                        </button>
                      </div>
                      <div className="input-wrap has-unit">
                        <input
                          className="input"
                          id={`value-${item.code}`}
                          type="text"
                          inputMode={
                            definition?.minValue === null
                              ? "text"
                              : definition?.valueType === "integer"
                                ? "numeric"
                                : "decimal"
                          }
                          autoComplete="off"
                          maxLength={128}
                          value={item.value}
                          placeholder="측정값 입력"
                          onChange={(e) =>
                            updateItem(item.code, "value", e.target.value)
                          }
                          aria-invalid={!!errors[`item.${item.code}`]}
                          aria-describedby={`error-${item.code}`}
                        />
                        <span className="input-unit">{definition?.unit}</span>
                      </div>
                      <FieldError
                        id={`error-${item.code}`}
                        message={errors[`item.${item.code}`]}
                      />
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                className="button secondary"
                onClick={() => setPicker(true)}
              >
                <Plus size={19} />
                측정 항목 추가
              </button>
              <FieldError message={errors.items} />
              {!!items.length && (
                <details className="accordion">
                  <summary>
                    항목별 결과표 등급{" "}
                    <span className="optional-label">(선택)</span>
                  </summary>
                  <div className="stack">
                    {items.map((item) => (
                      <div className="field" key={item.code}>
                        <label htmlFor={`grade-${item.code}`}>
                          {catalog?.definitions.find(
                            (d) => d.code === item.code,
                          )?.label ?? item.code}{" "}
                          등급
                        </label>
                        <input
                          id={`grade-${item.code}`}
                          maxLength={100}
                          value={item.grade}
                          onChange={(e) =>
                            updateItem(item.code, "grade", e.target.value)
                          }
                          placeholder="결과표에 적힌 등급"
                        />
                        <FieldError message={errors[`grade.${item.code}`]} />
                      </div>
                    ))}
                  </div>
                </details>
              )}
              <p className="caption center">
                모르는 값은 비워 두세요. 실제 0은 0으로 입력해요.
              </p>
            </fieldset>
            <div className="sticky-actions">
              <button
                className="button primary"
                disabled={busy || gone || conflict}
              >
                <SubmitLabel busy={busy}>
                  {busy
                    ? "저장 확인 중"
                    : uncertain
                      ? "같은 내용으로 다시 확인"
                      : base
                        ? "수정 내용 저장"
                        : `${validItems.length}개 항목 저장하기`}
                </SubmitLabel>
              </button>
            </div>
          </form>
        )}
        {picker && catalog && (
          <CatalogPicker
            definitions={catalog.definitions.filter(
              (d) =>
                Number(meta.age) >= d.minAge && Number(meta.age) <= d.maxAge,
            )}
            selected={items.map((i) => i.code)}
            onSelect={(code) => {
              setItems((old) => [...old, { code, value: "", grade: "" }]);
              setDirty(true);
            }}
            onClose={() => setPicker(false)}
          />
        )}
        {conflict && (
          <Dialog
            title="최신 기록을 확인해 주세요"
            onClose={() => setConflict(false)}
          >
            <div className="stack">
              <p className="muted">
                다른 곳에서 기록이 바뀌었어요. 작성한 입력은 유지되어 있어요.
                아래는 서버에 저장된 최신 내용입니다.
              </p>
              {latest && catalog ? (
                <>
                  <p className="caption">
                    {latest.data.measuredOn} · 만 {latest.data.ageAtMeasurement}
                    세 · {latest.data.centerName || "센터 미입력"}
                  </p>
                  <RecordValues record={latest.data} catalog={catalog} />
                  <button className="button primary" onClick={useLatest}>
                    최신 기록으로 다시 편집
                  </button>
                </>
              ) : (
                <button
                  className="button secondary"
                  onClick={() => void readLatest()}
                  disabled={busy}
                >
                  최신 기록 불러오기
                </button>
              )}
              <button
                className="button secondary"
                onClick={() => setConflict(false)}
              >
                내 입력으로 돌아가기
              </button>
              <p className="caption">
                최신 기록으로 다시 편집하면 작성 중인 입력이 바뀝니다. 자동으로
                덮어쓰지 않아요.
              </p>
            </div>
          </Dialog>
        )}
      </div>
    </Shell>
  );
}
