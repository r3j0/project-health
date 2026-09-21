import { ApiError, errorMessage, request } from "./http";
import type { AuthResponse, User } from "./types";
import { measurementDrafts } from "./measurement-drafts";
type Session = {
  status: "loading" | "authenticated" | "anonymous" | "error";
  user: User | null;
  error?: string;
  generation: number;
  profileRevision: number;
};
const initial: Session = {
  status: "loading",
  user: null,
  generation: 0,
  profileRevision: 0,
};
let session = initial;
let accessToken: string | null = null;
let refreshPromise: Promise<void> | undefined;
let startup: Promise<void> | undefined;
let channel: BroadcastChannel | undefined;
const listeners = new Set<() => void>();
export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getSession = () => session;
export const getServerSession = () => initial;
function publish(next: Session) {
  session = next;
  for (const listener of listeners) listener();
}
function accept(auth: AuthResponse, broadcast = true, newLogin = false) {
  measurementDrafts.setOwner(auth.user.id);
  accessToken = auth.access_token;
  publish({
    status: "authenticated",
    user: auth.user,
    profileRevision: session.profileRevision,
    generation:
      session.generation +
      (newLogin || session.user?.id !== auth.user.id ? 1 : 0),
  });
  if (broadcast)
    channel?.postMessage({ type: "authenticated", auth, newLogin });
}
function clear(reason: "expired" | "logout" = "expired", broadcast = true) {
  if (reason === "logout") measurementDrafts.clear();
  else measurementDrafts.suspend();
  accessToken = null;
  publish({
    status: "anonymous",
    user: null,
    generation: session.generation + 1,
    profileRevision: session.profileRevision + 1,
  });
  if (broadcast) channel?.postMessage({ type: "logout", reason });
}
async function locked<T>(action: () => Promise<T>): Promise<T> {
  if (navigator.locks)
    return navigator.locks.request("modu-auth-session", action);
  return action();
}
export function startSession() {
  if (startup) return startup;
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("modu-auth-session");
    channel.onmessage = ({ data }) => {
      if (data?.type === "logout")
        clear(data.reason === "expired" ? "expired" : "logout", false);
      if (data?.type === "profile-changed" && data.userId === session.user?.id)
        invalidateUserProfile(false);
      if (
        data?.type === "authenticated" &&
        typeof data.auth?.access_token === "string" &&
        typeof data.auth?.user?.id === "string"
      )
        accept(data.auth, false, !!data.newLogin);
    };
  }
  startup = refresh().catch((error) => {
    if (session.status !== "anonymous" && session.status !== "authenticated")
      publish({
        status: "error",
        user: null,
        generation: session.generation,
        profileRevision: session.profileRevision,
        error: errorMessage(error),
      });
  });
  return startup;
}
export async function refresh(failedToken?: string | null) {
  if (refreshPromise) return refreshPromise;
  refreshPromise = locked(async () => {
    if (accessToken && accessToken !== failedToken) return;
    // Without cross-tab locking, do not rotate cookies unsafely; explicit login still works.
    if (!navigator.locks) {
      clear("expired", false);
      throw new ApiError(
        401,
        "자동 로그인 유지가 지원되지 않는 환경이에요. 다시 로그인해 주세요.",
      );
    }
    const generation = session.generation;
    try {
      const result = await request<AuthResponse>("/auth/refresh", {
        method: "POST",
        headers: { "X-CSRF-Protection": "1" },
      });
      if (generation === session.generation) accept(result.data);
    } catch (error) {
      if (
        generation === session.generation &&
        error instanceof ApiError &&
        error.status === 401
      )
        clear();
      throw error;
    }
  }).finally(() => {
    refreshPromise = undefined;
  });
  return refreshPromise;
}
export async function authenticate(
  mode: "login" | "register",
  email: string,
  password: string,
) {
  await startup;
  return locked(async () => {
    const result = await request<AuthResponse>(`/auth/${mode}`, {
      method: "POST",
      headers: { "X-CSRF-Protection": "1" },
      body: JSON.stringify({ email, password }),
    });
    accept(result.data, true, true);
  });
}
export async function logout() {
  return locked(async () => {
    try {
      await request("/auth/logout", {
        method: "POST",
        headers: {
          "X-CSRF-Protection": "1",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });
    } catch (error) {
      // Invalid credentials still end this local session; other failures remain retryable.
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
    }
    clear("logout");
  });
}
export async function api<T>(path: string, options: RequestInit = {}) {
  const generation = session.generation,
    userId = session.user?.id,
    token = accessToken;
  if (!token) throw new ApiError(401, "로그인이 필요해요.");
  const send = () =>
    request<T>(path, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${accessToken}` },
    });
  let result;
  try {
    result = await send();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    await refresh(token);
    if (session.user?.id !== userId || session.generation !== generation)
      throw new ApiError(401, "계정이 변경되었어요. 다시 확인해 주세요.");
    result = await send();
  }
  if (session.user?.id !== userId || session.generation !== generation)
    throw new ApiError(401, "로그인 상태가 변경되었어요.");
  if (
    options.method &&
    /^(POST|PATCH|DELETE)$/i.test(options.method) &&
    /^\/measurements(?:\/|$)/.test(path)
  )
    invalidateUserProfile();
  return result;
}

export function invalidateUserProfile(broadcast = true) {
  if (session.status !== "authenticated") return;
  publish({ ...session, profileRevision: session.profileRevision + 1 });
  if (broadcast)
    channel?.postMessage({ type: "profile-changed", userId: session.user?.id });
}

/** Credential mutations are never replayed: a 401 can mean a wrong password. */
export async function changeAccount(
  method: "PATCH" | "DELETE",
  body:
    | { currentPassword: string; email?: string; newPassword?: string }
    | { password: string },
) {
  const generation = session.generation;
  // Refresh an expired session with a safe read before entering the auth lock.
  await api<User>("/auth/me");
  return locked(async () => {
    if (session.generation !== generation || !accessToken)
      throw new ApiError(
        401,
        "로그인 상태가 변경되었어요. 다시 로그인해 주세요.",
      );
    try {
      await request<null>("/users/me", {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-CSRF-Protection": "1",
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401)
        throw new ApiError(
          401,
          "본인 확인에 실패했어요. 현재 비밀번호를 확인해 주세요. 계속 실패하면 다시 로그인해 주세요.",
        );
      if (error instanceof ApiError && error.status === 409)
        throw new ApiError(
          409,
          "이미 사용 중인 이메일이에요. 다른 이메일을 입력해 주세요.",
        );
      if (
        error instanceof ApiError &&
        (error.status === 0 || error.status >= 500)
      )
        throw new ApiError(
          error.status,
          "처리 결과를 확인하지 못했어요. 계정이 변경되었을 수 있으니 다시 로그인해 확인해 주세요.",
        );
      throw error;
    }
    if (session.generation === generation) clear("logout");
  });
}
