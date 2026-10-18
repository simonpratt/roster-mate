import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SyncIndicator, type IndicatorStatus } from "./SyncIndicator";

describe("SyncIndicator", () => {
  const cases: [IndicatorStatus, string][] = [
    ["synced", "Synced"],
    ["pending", "3 pending"],
    ["offline", "Offline"],
    ["unauthorized", "Sign in needed"],
    ["error", "Sync failed"],
    ["syncing", "Syncing…"],
  ];

  it.each(cases)("shows %s as %s", (status, text) => {
    render(<SyncIndicator status={status} pendingCount={3} onSync={() => {}} onSignIn={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(text);
  });

  it("makes Sync failed a Retry button", () => {
    const onSync = vi.fn();
    render(<SyncIndicator status="error" pendingCount={0} onSync={onSync} onSignIn={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Sync failed. Retry" }));
    expect(onSync).toHaveBeenCalledOnce();
  });

  it("goes to sign in from Sign in needed, and does nothing offline", () => {
    const onSignIn = vi.fn();
    const { rerender } = render(<SyncIndicator status="unauthorized" pendingCount={0} onSync={() => {}} onSignIn={onSignIn} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in needed. Sign in" }));
    expect(onSignIn).toHaveBeenCalledOnce();
    rerender(<SyncIndicator status="offline" pendingCount={0} onSync={() => {}} onSignIn={onSignIn} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
