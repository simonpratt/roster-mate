import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { renderApp, setOnline, stubFetch } from "../test-utils";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fillAndSubmit(username: string, password: string) {
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: username } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("Login", () => {
  it("posts the credentials and goes to the calendar on 204", async () => {
    const fetchMock = stubFetch({ "/api/login": { status: 204 } });
    renderApp("/login");
    fillAndSubmit("simon", "secret");

    expect(await screen.findByText("Your shifts will appear here.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/login",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ username: "simon", password: "secret" }),
      }),
    );
  });

  it("shows the busy state while signing in", async () => {
    let finish: (r: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        String(input) === "/api/login"
          ? new Promise<Response>((resolve) => (finish = resolve))
          : Promise.resolve(new Response(null, { status: 404 })),
      ),
    );
    renderApp("/login");
    fillAndSubmit("simon", "secret");

    const button = await screen.findByRole("button", { name: "Signing in…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("Username")).toBeDisabled();
    await act(async () => finish(new Response(null, { status: 204 })));
  });

  it("shows an error, clears and focuses the password on 401", async () => {
    stubFetch({ "/api/login": { status: 401, body: { error: "unauthorized" } } });
    renderApp("/login");
    fillAndSubmit("simon", "wrong");

    expect(await screen.findByRole("alert")).toHaveTextContent("That username and password don’t match.");
    const password = screen.getByLabelText("Password");
    expect(password).toHaveValue("");
    expect(screen.getByLabelText("Username")).toHaveValue("simon");
    expect(password).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(password).toHaveFocus());
    expect(screen.queryByText("Your shifts will appear here.")).not.toBeInTheDocument();
  });

  it("says the server can't be reached on a network error", async () => {
    stubFetch({ "/api/login": new TypeError("Failed to fetch") });
    renderApp("/login");
    fillAndSubmit("simon", "secret");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Can’t reach Roster Mate. Check you’re on your home network.",
    );
    expect(screen.getByLabelText("Password")).toHaveValue("secret");
  });

  it("offline with no shifts on the phone: shows the banner without Back to calendar", async () => {
    setOnline(false);
    stubFetch({});
    renderApp("/login");

    expect(screen.getByRole("status")).toHaveTextContent(
      "You’re offline. Sign in when you’re back on your home network.",
    );
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
    // Give the local-shift query time to answer before checking the button stays hidden.
    await act(() => db.shifts.count());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: "Back to calendar" })).not.toBeInTheDocument();
  });

  it("offline with shifts on the phone: offers Back to calendar", async () => {
    setOnline(false);
    await db.shifts.put({ date: "2026-11-03", code: "L", note: "", editedAt: 1 });
    const fetchMock = stubFetch({});
    renderApp("/login");

    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
    fireEvent.click(await screen.findByRole("button", { name: "Back to calendar" }));
    expect(await screen.findByText("Your shifts will appear here.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
