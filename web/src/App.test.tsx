import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp, setOnline, stubFetch } from "./test-utils";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("App", () => {
  it("stays on the home page with a valid session", async () => {
    const fetchMock = stubFetch({ "/api/session": { status: 200, body: { username: "simon" } } });
    renderApp("/");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/session", expect.anything()));
    expect(screen.getByRole("heading", { name: "Roster Mate" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("goes to the login page when the session check is a 401", async () => {
    stubFetch({ "/api/session": { status: 401, body: { error: "unauthorized" } } });
    renderApp("/");
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
  });

  it("does not check the session or redirect while offline", async () => {
    setOnline(false);
    const fetchMock = stubFetch({ "/api/session": { status: 401 } });
    renderApp("/");
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("stays put when the server can't be reached", async () => {
    const fetchMock = stubFetch({ "/api/session": new TypeError("Failed to fetch") });
    renderApp("/");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });
});
