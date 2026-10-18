import { render } from "@testing-library/react";
import { MemoryRouter, type InitialEntry } from "react-router";
import { vi } from "vitest";
import { App } from "./App";

/** Renders the whole app at path (with any location state) in a memory router. */
export function renderApp(path: InitialEntry = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

type Reply = { status: number; body?: unknown } | Error;

/**
 * Replaces fetch with a stub answering each path from replies (a 404 for any other), and
 * returns the mock so tests can inspect calls.
 */
export function stubFetch(replies: Record<string, Reply>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const reply = replies[String(input)] ?? { status: 404, body: { error: "not found" } };
    if (reply instanceof Error) throw reply;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Sets navigator.onLine for the rest of the test. */
export function setOnline(online: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
}
