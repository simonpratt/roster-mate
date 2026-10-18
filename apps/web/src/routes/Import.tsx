import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { ApiError, checkHealth, extractRoster, UnauthorizedError, type Extraction } from "../api";
import { Banner } from "../components/Banner";
import { Button, buttonClassName } from "../components/Button";
import {
  AlertTriangleIcon,
  CameraIcon,
  ChevronLeftIcon,
  CloudOffIcon,
  HelpCircleIcon,
  ImageIcon,
  RetryIcon,
  UserMissingIcon,
  WifiOffIcon,
} from "../components/icons";
import { ReviewList } from "../components/ReviewList";
import { formatShortDate, monthOf } from "../lib/dates";
import { downscaleImage } from "../lib/image";
import { setShifts, useShiftsOn } from "../shifts/repo";
import { reviewRows, shiftsToSave, summary, type RowEdit } from "../shifts/review";

// Import (/import), docs/ux-spec.md §6.4 and docs/designs/Import*.dc.html: take or choose a roster
// photo, wait while it's read, then review each proposed shift against the saved one before
// saving. Nothing is saved straight from the photo, and the photo is not kept.

type Failure = "tooLarge" | "readFailed" | "connectionLost";

type Stage =
  | { name: "checking" }
  | { name: "offline" }
  | { name: "pick" }
  | { name: "extracting" }
  | { name: "review"; result: Extraction }
  | { name: "notFound" }
  | { name: "noShifts" }
  | { name: Failure };

/** The server gives up at 90 s with a 502; past this the client treats the read as failed. */
const EXTRACT_TIMEOUT_MS = 100_000;

export function Import() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>(() => (navigator.onLine ? { name: "checking" } : { name: "offline" }));
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const photo = useRef<Blob | null>(null);
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const inFlight = useRef<AbortController | null>(null);

  // Import needs the server: offline, or online but unable to reach it (mobile data away from
  // the home network), shows the needs-a-connection state instead of the picker.
  useEffect(() => {
    if (!navigator.onLine) return;
    let cancelled = false;
    void checkHealth().then((ok) => {
      if (!cancelled) setStage(ok ? { name: "pick" } : { name: "offline" });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Abort a running extraction when leaving the screen; release the thumbnail when it changes.
  useEffect(() => () => inFlight.current?.abort(), []);
  useEffect(() => () => void (photoUrl && URL.revokeObjectURL(photoUrl)), [photoUrl]);

  async function extract(image: Blob) {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, EXTRACT_TIMEOUT_MS);
    setStage({ name: "extracting" });
    setEdits({});
    try {
      const result = await extractRoster(image, controller.signal);
      if (!result.personFound) setStage({ name: "notFound" });
      else if (result.shifts.length === 0) setStage({ name: "noShifts" });
      else setStage({ name: "review", result });
    } catch (err) {
      if (controller.signal.aborted && !timedOut) return; // Cancelled: already back at Step 1.
      if (err instanceof UnauthorizedError) navigate("/login");
      else setStage({ name: failureFor(err, timedOut) });
    } finally {
      clearTimeout(timer);
      if (inFlight.current === controller) inFlight.current = null;
    }
  }

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so choosing the same photo again fires a change
    if (!file) return;
    setPhotoUrl(URL.createObjectURL(file));
    setStage({ name: "extracting" });
    try {
      photo.current = await downscaleImage(file);
    } catch {
      // The browser couldn't decode it: not an image it supports.
      setStage({ name: "tooLarge" });
      return;
    }
    await extract(photo.current);
  }

  function toPick() {
    inFlight.current?.abort();
    setStage({ name: "pick" });
  }

  // Review
  const result = stage.name === "review" ? stage.result : null;
  const dates = useMemo(() => result?.shifts.map((s) => s.date) ?? [], [result]);
  const saved = useShiftsOn(dates);
  const rows = result && saved ? reviewRows(result.shifts, saved, edits) : [];
  const toSave = shiftsToSave(rows);

  async function save() {
    if (toSave.length === 0) return;
    await setShifts(toSave);
    navigate("/", { replace: true, state: { month: monthOf(toSave[0]!.date) } });
  }

  function back() {
    if (toSave.length > 0 && !window.confirm("Discard this import?")) return;
    navigate("/");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-app flex-col pt-[env(safe-area-inset-top)]">
      <header className="flex h-15 flex-none items-center gap-1 py-2 pr-4 pl-1">
        <button
          type="button"
          aria-label="Back to calendar"
          onClick={back}
          className="flex size-11 items-center justify-center rounded-field text-text-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <ChevronLeftIcon className="size-5.5" />
        </button>
        <h1 className="m-0 text-title">Import roster</h1>
      </header>

      {(stage.name === "checking" || stage.name === "pick") && (
        <PickStep checking={stage.name === "checking"} onPhoto={(e) => void onPhoto(e)} />
      )}
      {stage.name === "offline" && <OfflineStep />}
      {stage.name === "review" && result && saved && (
        <ReviewStep
          result={result}
          rows={rows}
          saveCount={toSave.length}
          onEdit={(date, edit) => setEdits((prev) => ({ ...prev, [date]: { ...prev[date], ...edit } }))}
          onSave={() => void save()}
        />
      )}
      {isPhotoStage(stage.name) && (
        <PhotoStep
          stage={stage.name}
          photoUrl={photoUrl}
          onCancel={toPick}
          onRetry={() => photo.current && void extract(photo.current)}
        />
      )}
    </main>
  );
}

function failureFor(err: unknown, timedOut: boolean): Failure {
  if (timedOut) return "readFailed";
  if (err instanceof ApiError) return err.status === 413 || err.status === 415 ? "tooLarge" : "readFailed";
  return "connectionLost"; // fetch's TypeError: the server couldn't be reached
}

type PhotoStageName = "extracting" | "notFound" | "noShifts" | Failure;

function isPhotoStage(name: Stage["name"]): name is PhotoStageName {
  return name in MESSAGES;
}

const failedBadge = "bg-failed-surface border-failed-line text-failed-icon";

// Step 2 and its outcomes share one layout: the photo, a message, and the actions
// (docs/designs/Import.dc.html, stages extracting to connectionLost).
const MESSAGES: Record<
  PhotoStageName,
  { title: string; body?: string; dim: string; badge?: { icon: ReactNode; classes: string } }
> = {
  extracting: { title: "Extracting…", body: "Finding the shifts in your row. This can take up to a minute.", dim: "" },
  notFound: {
    title: "Couldn’t find you on this roster.",
    body: "Check the photo shows your name as it’s printed on the roster.",
    dim: "opacity-60",
    badge: { icon: <UserMissingIcon className="size-7" />, classes: "bg-surface-raised border-border-strong text-text-soft" },
  },
  noShifts: { title: "Found you, but no shifts could be read.", dim: "" },
  tooLarge: {
    title: "That image is too large or not a supported format.",
    dim: "opacity-35",
    badge: { icon: <AlertTriangleIcon className="size-7" />, classes: failedBadge },
  },
  readFailed: {
    title: "Couldn’t read the roster.",
    body: "Try again, or use a clearer photo.",
    dim: "opacity-35",
    badge: { icon: <HelpCircleIcon className="size-7" />, classes: failedBadge },
  },
  connectionLost: {
    title: "Lost connection while reading.",
    body: "Try again when you’re online.",
    dim: "opacity-35",
    badge: { icon: <WifiOffIcon className="size-7" />, classes: failedBadge },
  },
};

const fileInputFocus =
  "cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus";

function PickStep({ checking, onPhoto }: { checking: boolean; onPhoto: (e: ChangeEvent<HTMLInputElement>) => void }) {
  const take = (
    <>
      <CameraIcon className="size-5" />
      Take photo
    </>
  );
  const choose = (
    <>
      <ImageIcon className="size-5" />
      Choose from library
    </>
  );
  return (
    <section aria-live="polite" className="flex flex-1 flex-col px-6 pt-8 pb-[max(32px,env(safe-area-inset-bottom))]">
      <div className="flex flex-col gap-3.5">
        <h2 className="m-0 text-hero text-balance">Photograph your roster</h2>
        <p className="m-0 text-body text-pretty text-text-muted">
          Claude reads the photo and finds your row. You’ll check every shift before anything is saved.
        </p>
      </div>
      <ol className="m-0 mt-8 flex list-none flex-col gap-3 p-0">
        {["Fit the whole roster in frame, with your name visible.", "Printed sheets and screenshots both work."].map(
          (tip, i) => (
            <li key={tip} className="flex items-start gap-3">
              <span className="flex size-7 flex-none items-center justify-center rounded-lg border border-border bg-surface font-mono text-footnote font-bold text-text-soft">
                {i + 1}
              </span>
              <p className="m-0 mt-0.75 text-callout text-text-soft">{tip}</p>
            </li>
          ),
        )}
      </ol>
      <div className="mt-auto flex flex-col gap-2.5 pt-8">
        {checking ? (
          <>
            <Button disabled>{take}</Button>
            <Button variant="outline-wide" disabled>
              {choose}
            </Button>
          </>
        ) : (
          <>
            <label className={`${buttonClassName("primary")} ${fileInputFocus}`}>
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={onPhoto} />
              {take}
            </label>
            <label className={`${buttonClassName("outline-wide")} ${fileInputFocus}`}>
              <input type="file" accept="image/*" className="sr-only" onChange={onPhoto} />
              {choose}
            </label>
          </>
        )}
        <p className="m-0 mt-1.5 text-center text-footnote text-text-faint">The photo is read once and not stored.</p>
      </div>
    </section>
  );
}

function OfflineStep() {
  return (
    <section role="status" className="flex flex-1 flex-col px-6 pt-24 pb-[max(32px,env(safe-area-inset-bottom))]">
      <div className="flex flex-col items-start gap-5">
        <span className="flex size-16 items-center justify-center rounded-[20px] border border-border bg-surface text-text-muted">
          <CloudOffIcon className="size-7.5" />
        </span>
        <div className="flex flex-col gap-2.5">
          <h2 className="m-0 text-display font-bold">Import needs a connection</h2>
          <p className="m-0 text-body text-pretty text-text-muted">
            Reconnect to your home network to import a roster. You can still view and edit shifts while you’re away.
          </p>
        </div>
      </div>
      <Link to="/" className={`${buttonClassName("outline-wide")} mt-auto`}>
        Back to calendar
      </Link>
    </section>
  );
}

function PhotoStep({
  stage,
  photoUrl,
  onCancel,
  onRetry,
}: {
  stage: PhotoStageName;
  photoUrl: string | null;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const msg = MESSAGES[stage];
  const extracting = stage === "extracting";
  const failed = stage === "tooLarge" || stage === "readFailed" || stage === "connectionLost";
  return (
    <section className="flex flex-1 flex-col gap-7 px-4 pt-4 pb-[max(32px,env(safe-area-inset-bottom))]">
      <div className="relative flex h-82 items-center justify-center overflow-hidden rounded-panel border border-border-subtle bg-surface">
        {photoUrl && <img src={photoUrl} alt="" className={`size-full object-contain ${msg.dim}`} />}
        {extracting && (
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-1/3 animate-scan border-b-2 border-focus bg-linear-to-b from-transparent to-scan motion-reduce:animate-none"
          />
        )}
        {msg.badge && (
          <span
            aria-hidden="true"
            className={`absolute flex size-16 items-center justify-center rounded-full border ${msg.badge.classes}`}
          >
            {msg.badge.icon}
          </span>
        )}
        <span className="absolute bottom-3 left-3 text-caption font-normal text-text-faint">Roster photo</span>
      </div>
      <div role={extracting ? "status" : "alert"} className="flex flex-col gap-2.5 px-2">
        <h2 className={`m-0 text-balance ${extracting ? "text-display font-bold" : "text-headline"}`}>{msg.title}</h2>
        {msg.body && <p className="m-0 text-body text-pretty text-text-muted">{msg.body}</p>}
      </div>
      <div className="mt-auto flex flex-col gap-2.5">
        {extracting && (
          <Button variant="outline-wide" onClick={onCancel}>
            Cancel
          </Button>
        )}
        {(stage === "notFound" || stage === "noShifts") && <Button onClick={onCancel}>Try another photo</Button>}
        {failed && (
          <>
            <Button onClick={onRetry}>
              <RetryIcon className="size-4.5" />
              Try again
            </Button>
            <Button variant="outline-wide" onClick={onCancel}>
              Choose another photo
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

function ReviewStep({
  result,
  rows,
  saveCount,
  onEdit,
  onSave,
}: {
  result: Extraction;
  rows: ReturnType<typeof reviewRows>;
  saveCount: number;
  onEdit: (date: string, edit: RowEdit) => void;
  onSave: () => void;
}) {
  const n = rows.length;
  const range = n > 0 ? `${formatShortDate(rows[0]!.date)} – ${formatShortDate(rows[n - 1]!.date)}` : "";
  return (
    <section aria-live="polite" className="flex flex-1 flex-col">
      <div className="flex flex-none flex-col gap-3 px-4 pt-1 pb-3">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-headline">
            {n} {n === 1 ? "shift" : "shifts"} found
          </h2>
          <p className="m-0 text-label font-normal text-text-muted tabular-nums">
            {range} · {summary(rows)}
          </p>
        </div>
        {result.warnings.map((w) => (
          <Banner key={w} tone="caution" icon={<AlertTriangleIcon className="size-4.5" />}>
            {w}
          </Banner>
        ))}
      </div>
      <div className="flex-1">
        <ReviewList rows={rows} onEdit={onEdit} />
      </div>
      <div className="sticky bottom-0 flex flex-col gap-2 border-t border-cell-line bg-bg px-4 pt-3 pb-[max(28px,env(safe-area-inset-bottom))]">
        <p className="m-0 text-center text-footnote text-text-faint">Unticked rows are left as they are.</p>
        <Button disabled={saveCount === 0} onClick={onSave}>
          {saveCount === 0 ? "Nothing selected" : `Save ${saveCount} ${saveCount === 1 ? "shift" : "shifts"}`}
        </Button>
      </div>
    </section>
  );
}
