import { useEffect } from "react";
import { sync } from "./engine";

/** How often to sync while the app is open, visible and online. */
export const SYNC_INTERVAL_MS = 60_000;

/**
 * Syncs on start, when the connection returns, when the app comes back to the foreground and
 * every minute while it is visible and online. Edits trigger their own sync (shifts/repo.ts).
 * iPhones don't run true background sync, so these cover the gaps.
 */
export function useSyncTriggers() {
  useEffect(() => {
    const trigger = () => void sync.trigger();
    const onVisibility = () => {
      if (document.visibilityState === "visible") trigger();
    };
    trigger();
    window.addEventListener("online", trigger);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) trigger();
    }, SYNC_INTERVAL_MS);
    return () => {
      window.removeEventListener("online", trigger);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(timer);
    };
  }, []);
}
