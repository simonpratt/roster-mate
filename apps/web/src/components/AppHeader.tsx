import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { buttonClassName } from "./Button";
import { useEmailEnabled } from "../recipients/flag";
import { CameraIcon, HistoryIcon, MailIcon, MoreVerticalIcon, SignOutIcon, UsersIcon } from "./icons";

// The Calendar's app header, docs/ux-spec.md §5.1 and docs/designs/Main.dc.html: the sync
// indicator on the left, then Import and the overflow menu (docs/designs/CalendarMenu.dc.html):
// Babysitters, History, Roster emails (only when the server has email set up, §5.1), then Sign out.
type AppHeaderProps = {
  /** The sync indicator. */
  sync: ReactNode;
  /** Called when Sign out is chosen from the menu. */
  onSignOut: () => void;
};

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

const menuItem = "flex h-12 w-full items-center gap-3 rounded-control px-3 text-left text-callout font-medium text-text";

export function AppHeader({ sync, onSignOut }: AppHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const emailEnabled = useEmailEnabled();

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <header className="relative flex items-center justify-between gap-2 pt-[max(12px,env(safe-area-inset-top))] pr-2 pb-2 pl-4">
      {sync}
      <div className="flex items-center gap-1">
        <Link to="/import" className={`${buttonClassName("compact")} gap-2`}>
          <CameraIcon className="size-4.5" />
          Import
        </Link>
        <button
          type="button"
          aria-label="More"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          className={`flex size-11 items-center justify-center rounded-field text-text-soft ${menuOpen ? "bg-surface-raised" : ""} ${focus}`}
        >
          <MoreVerticalIcon className="size-5" />
        </button>
      </div>
      {menuOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            tabIndex={-1}
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div
            role="menu"
            aria-label="More"
            className="absolute top-full right-3 z-20 w-52 rounded-panel border border-border-input bg-surface-raised p-1.5 shadow-popover"
          >
            <Link
              to="/babysitters"
              role="menuitem"
              autoFocus
              className={`${menuItem} ${focus}`}
            >
              <UsersIcon className="size-4.5 text-text-muted" />
              Babysitters
            </Link>
            <Link to="/history" role="menuitem" className={`${menuItem} ${focus}`}>
              <HistoryIcon className="size-4.5 text-text-muted" />
              History
            </Link>
            {emailEnabled && (
              <Link to="/emails" role="menuitem" className={`${menuItem} ${focus}`}>
                <MailIcon className="size-4.5 text-text-muted" />
                Roster emails
              </Link>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onSignOut();
              }}
              className={`${menuItem} ${focus}`}
            >
              <SignOutIcon className="size-4.5 text-text-muted" />
              Sign out
            </button>
          </div>
        </>
      )}
    </header>
  );
}
