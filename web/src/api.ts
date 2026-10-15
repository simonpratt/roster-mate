// A small wrapper over fetch for the server's JSON API (docs/design.md § Authentication).
// Only the login screen, the session check and (later) the sync engine call it; the UI reads
// shifts from IndexedDB.

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
 * Sends a request to path with an optional JSON body and returns the parsed JSON response, or
 * undefined for 204. Throws UnauthorizedError on 401, ApiError on any other error status, and
 * fetch's TypeError when the server can't be reached.
 */
export async function request<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T | undefined> {
  const hasBody = init.body !== undefined;
  const res = await fetch(path, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(init.body) : undefined,
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
