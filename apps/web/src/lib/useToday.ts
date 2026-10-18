import { useEffect, useState } from "react";
import { todayDate, type DateString } from "./dates";

/**
 * The phone's local date, re-read every minute and when the app returns to the foreground, so
 * "today" rolls over if the app stays open past midnight (docs/ux-spec.md §7.2).
 */
export function useToday(): DateString {
  const [today, setToday] = useState(() => todayDate());
  useEffect(() => {
    const update = () => setToday(todayDate());
    const onVisibility = () => {
      if (document.visibilityState === "visible") update();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const timer = setInterval(update, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(timer);
    };
  }, []);
  return today;
}
