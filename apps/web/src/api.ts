// A small wrapper over fetch for the server's JSON API (docs/design.md § Authentication).
// Only the login screen, the session check, the sync engine, the Import screen (extraction and
// its connection check) and the Roster emails screen (the recipients, which live only on the
// server, ADR 0005) call it; the UI reads shifts from IndexedDB.

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
  /** The `error` text of the server's JSON answer, when it had one. */
  readonly serverError: string | undefined;
  constructor(status: number, serverError?: string) {
    super(`HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.serverError = serverError;
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
  if (!res.ok) throw new ApiError(res.status, await errorText(res));
  if (res.status === 204) return undefined;
  return (await res.json()) as T;
}

/** The `error` field of an error answer's JSON body, if it has one. */
async function errorText(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { error?: unknown } | null;
    return typeof body?.error === "string" ? body.error : undefined;
  } catch {
    return undefined;
  }
}

/** Signs in, setting the session cookie. */
export async function login(username: string, password: string): Promise<void> {
  await request("/api/login", { method: "POST", body: { username, password } });
}

/** The signed-in user, and whether the server has roster emails set up. */
export interface Session {
  username: string;
  email: boolean;
}

/** Returns the session, or throws UnauthorizedError. `email` is false from an older server. */
export async function getSession(): Promise<Session> {
  const s = await request<{ username: string; email?: boolean }>("/api/session");
  if (!s) throw new ApiError(204);
  return { username: s.username, email: s.email === true };
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

/** A recipient of every roster email; `babysitter` is "" for none. */
export interface Recipient {
  email: string;
  babysitter: string;
}

/** The newest roster email: when (unix ms), whether every send succeeded, and how many it reached. */
export interface LastSend {
  at: number;
  ok: boolean;
  recipients: number;
}

/** The answer of GET and PUT /api/recipients (docs/design.md § Roster email recipients). */
export interface Recipients {
  recipients: Recipient[];
  lastSend: LastSend | null;
}

function recipientsFrom(res: Partial<Recipients> | undefined): Recipients {
  return { recipients: res?.recipients ?? [], lastSend: res?.lastSend ?? null };
}

/** Loads the recipients and the last roster email. Throws as request does; 404 is email off. */
export async function getRecipients(signal?: AbortSignal): Promise<Recipients> {
  return recipientsFrom(await request<Partial<Recipients>>("/api/recipients", { signal }));
}

/** Replaces the whole recipient list, answering as getRecipients. A 400 carries serverError. */
export async function putRecipients(list: Recipient[]): Promise<Recipients> {
  return recipientsFrom(
    await request<Partial<Recipients>>("/api/recipients", { method: "PUT", body: { recipients: list } }),
  );
}
