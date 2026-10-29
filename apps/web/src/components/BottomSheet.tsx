import { useCallback, useEffect, useRef, useState, type ReactNode, type TouchEvent } from "react";

// The bottom sheet, docs/ux-spec.md §5.5 and the date sheet in docs/designs/Main.dc.html: fixed
// to the bottom over a scrim, a drag handle, at most 90 % of the screen tall with its own scroll.
// It slides up in 200 ms and down in 150 ms (§4.6, none with reduced motion), closes on a scrim
// tap, Escape or a downward drag past 30 % of its height, traps focus, and returns focus on close
// to returnFocus, or else to whatever had it. It stays above the on-screen keyboard.
type BottomSheetProps = {
  /** The id of the sheet's heading. */
  labelledBy: string;
  /** Called once the sheet has closed. */
  onClose: () => void;
  /**
   * Where focus goes on close. A tap doesn't focus a button on every phone (iOS Safari), so the
   * element focused on opening isn't always the one tapped.
   */
  returnFocus?: () => HTMLElement | null;
  /** The content, given `close`, which slides the sheet away and then calls onClose. */
  children: (close: () => void) => ReactNode;
};

const CLOSE_MS = 150;
/** A downward drag past this share of the sheet's height closes it. */
const DRAG_CLOSE = 0.3;

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function reducedMotion(): boolean {
  return typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function BottomSheet({ labelledBy, onClose, returnFocus, children }: BottomSheetProps) {
  const sheet = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const returnFocusRef = useRef(returnFocus);
  returnFocusRef.current = returnFocus;
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const [drag, setDrag] = useState(0);
  const dragStart = useRef<number | null>(null);
  const keyboardInset = useKeyboardInset();

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (reducedMotion()) {
      onCloseRef.current();
      return;
    }
    setClosing(true);
    window.setTimeout(() => onCloseRef.current(), CLOSE_MS);
  }, []);

  // Focus moves into the sheet and back to where it was on close; the page behind doesn't scroll.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheet.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      (returnFocusRef.current?.() ?? previous)?.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "Tab" && sheet.current) {
        trapTab(e, sheet.current);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  // Dragging starts anywhere but in a field, and only when the sheet isn't scrolled.
  function onTouchStart(e: TouchEvent) {
    const t = e.touches[0];
    const inField = e.target instanceof HTMLInputElement;
    dragStart.current = t && !inField && (sheet.current?.scrollTop ?? 0) === 0 ? t.clientY : null;
  }

  function onTouchMove(e: TouchEvent) {
    const t = e.touches[0];
    if (dragStart.current === null || !t) return;
    setDrag(Math.max(0, t.clientY - dragStart.current));
  }

  function onTouchEnd() {
    if (dragStart.current === null) return;
    dragStart.current = null;
    const height = sheet.current?.offsetHeight ?? 0;
    if (height > 0 && drag > height * DRAG_CLOSE) close();
    else setDrag(0);
  }

  const motion = closing
    ? "translate-y-full transition-transform duration-150 ease-in"
    : drag > 0
      ? ""
      : "motion-safe:animate-sheet-in transition-transform duration-150";

  return (
    <div className="fixed inset-0 z-30">
      <div
        data-testid="sheet-backdrop"
        aria-hidden="true"
        onClick={close}
        className={`absolute inset-0 bg-scrim-sheet transition-opacity duration-150 motion-safe:animate-fade-in ${closing ? "opacity-0" : ""}`}
      />
      <section
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ bottom: keyboardInset, transform: drag > 0 && !closing ? `translateY(${drag}px)` : undefined }}
        className={
          "absolute inset-x-0 mx-auto flex max-h-[90dvh] max-w-app flex-col gap-4.5 overflow-y-auto overscroll-contain " +
          "rounded-t-dialog border-t border-border bg-surface shadow-sheet px-4 pt-2.5 pb-[calc(28px+env(safe-area-inset-bottom))] " +
          `outline-none ${motion}`
        }
      >
        <span aria-hidden="true" className="h-1 w-9 flex-none self-center rounded-full bg-border-strong" />
        {children(close)}
      </section>
    </div>
  );
}

/** Keeps Tab and Shift+Tab cycling through the focusable elements inside container. */
function trapTab(e: KeyboardEvent, container: HTMLElement) {
  const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) {
    e.preventDefault();
    return;
  }
  const active = document.activeElement;
  const inside = active instanceof Node && container.contains(active) && active !== container;
  if (e.shiftKey && (!inside || active === first)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (!inside || active === last)) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * How far the on-screen keyboard covers the bottom of the layout viewport, in px, so the sheet
 * can sit above it and keep Save reachable (docs/ux-spec.md §6.3).
 */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}
