// A small wrapper over fetch for the server's JSON API (docs/design.md § Authentication).
// Only the login screen, the session check, the sync engine and the Import screen (extraction
// and its connection check) call it; the UI reads shifts from IndexedDB.

/** The server answered 401: there is no valid session. */
export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}

/** The server answered with an error status other than 401. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Sends a request to path with an optional body and returns the parsed JSON response, or
 * undefined for 204. A FormData body is sent as multipart/form-data, anything else as JSON.
 * Throws UnauthorizedError on 401, ApiError on any other error status, and fetch's TypeError
 * when the server can't be reached (or an AbortError when signal aborts).
 */
export async function request<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T | undefined> {
  const isForm = init.body instanceof FormData;
  const isJson = init.body !== undefined && !isForm;
  const res = await fetch(path, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    headers: isJson ? { "Content-Type": "application/json" } : undefined,
    body: isForm ? (init.body as FormData) : isJson ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new ApiError(res.status);
  if (res.status === 204) return undefined;
  return (await res.json()) as T;
}

/** Signs in, setting the session cookie. */
export async function login(username: string, password: string): Promise<void> {
  await request("/api/login", { method: "POST", body: { username, password } });
}

/** Returns the signed-in username, or throws UnauthorizedError. */
export async function getSession(): Promise<{ username: string }> {
  const s = await request<{ username: string }>("/api/session");
  if (!s) throw new ApiError(204);
  return s;
}

/** How long the Import screen waits for /api/health before treating the server as unreachable. */
export const HEALTH_TIMEOUT_MS = 5000;

/**
 * Whether the server answers GET /api/health within timeoutMs. False on mobile data away from
 * the home network, where the browser is online but the LAN-only server can't be reached.
 */
export async function checkHealth(timeoutMs = HEALTH_TIMEOUT_MS): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await request("/api/health", { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** A shift read from a roster photo; `code` is null for an unmapped code, kept in rawCode. */
export interface ProposedShift {
  date: string;
  code: string | null;
  rawCode: string;
  uncertain: boolean;
}

/** The answer of POST /api/extract (docs/design.md § Roster extraction). */
export interface Extraction {
  personFound: boolean;
  shifts: ProposedShift[];
  warnings: string[];
}

/** Sends a roster photo for extraction. Throws as request does. Nothing is stored. */
export async function extractRoster(image: Blob, signal?: AbortSignal): Promise<Extraction> {
  const form = new FormData();
  form.append("image", image, "roster.jpg");
  const res = await request<Partial<Extraction>>("/api/extract", { method: "POST", body: form, signal });
  return {
    personFound: res?.personFound ?? false,
    shifts: res?.shifts ?? [],
    warnings: res?.warnings ?? [],
  };
}
