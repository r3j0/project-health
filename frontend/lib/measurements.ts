import { ApiError, request } from "./http";
import { api } from "./session";
import type { Catalog, Measurement, RecordResponse } from "./types";
export const getCatalog = (version?: string, signal?: AbortSignal) =>
  request<Catalog>(
    `/measurement-catalog${version ? `?version=${encodeURIComponent(version)}` : ""}`,
    { signal },
  ).then((r) => r.data);
export async function getRecord(
  id: string,
  signal?: AbortSignal,
): Promise<RecordResponse> {
  const r = await api<Measurement>(`/measurements/${encodeURIComponent(id)}`, {
    signal,
  });
  const etag = r.headers.get("ETag");
  if (!etag || !/^"[1-9]\d*"$/.test(etag))
    throw new ApiError(
      0,
      "기록의 변경 상태를 확인하지 못했어요. 다시 불러와 주세요.",
    );
  return { data: r.data, etag };
}
export function koreaDate(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
export function displayDate(value: string) {
  const [y, m, d] = value.split("-");
  return `${y}년 ${Number(m)}월 ${Number(d)}일`;
}
