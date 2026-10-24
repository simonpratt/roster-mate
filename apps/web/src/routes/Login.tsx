import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { login, UnauthorizedError } from "../api";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { AlertCircleIcon, CloudOffIcon, WifiOffIcon } from "../components/icons";
import { Logo } from "../components/Logo";
import { TextField } from "../components/TextField";
import { useHasLocalShifts } from "../shifts/repo";
import { checkSession } from "../recipients/flag";
import { sync } from "../sync/engine";
import { useOnline } from "../useOnline";

// Login (/login), docs/ux-spec.md §6.1 and docs/designs/Login*.dc.html.
type Status = "idle" | "busy" | "error" | "network";

export function Login() {
  const navigate = useNavigate();
  const online = useOnline();
  const hasLocalShifts = useHasLocalShifts();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const passwordRef = useRef<HTMLInputElement>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!online || status === "busy") return;
    setStatus("busy");
    try {
      await login(username, password);
      void sync.trigger();
      // The app's start-up session check skipped /login, so learn the email flag here.
      checkSession().catch(() => {});
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setStatus("error");
        setPassword("");
        // Focus once the field is enabled again after the busy state.
        requestAnimationFrame(() => passwordRef.current?.focus());
      } else {
        setStatus("network");
      }
    }
  }

  const busy = status === "busy";
  const invalid = status === "error";

  return (
    <main className="mx-auto flex min-h-dvh max-w-app flex-col px-6 pt-6 pb-10">
      {!online && (
        <Banner
          tone="neutral"
          icon={<CloudOffIcon className="size-5" />}
          action={
            // Only worth offering when there are shifts on the phone to go back to.
            hasLocalShifts && (
              <Button variant="outline" onClick={() => navigate("/", { replace: true })}>
                Back to calendar
              </Button>
            )
          }
        >
          You’re offline. Sign in when you’re back on your home network.
        </Banner>
      )}

      <div className={`flex flex-col gap-5 ${online ? "mt-18" : "mt-10"}`}>
        <Logo className="size-14" />
        <div className="flex flex-col gap-2">
          <h1 className="m-0 text-brand">Roster Mate</h1>
          <p className="m-0 text-body text-text-muted">Your shifts, on your phone.</p>
        </div>
      </div>

      <form className="mt-10 flex flex-col gap-4.5" onSubmit={onSubmit} noValidate>
        {online && status === "error" && (
          <Banner tone="danger" role="alert" icon={<AlertCircleIcon className="size-4.5" />}>
            That username and password don’t match.
          </Banner>
        )}
        {online && status === "network" && (
          <Banner tone="caution" role="alert" icon={<WifiOffIcon className="size-4.5" />}>
            Can’t reach Roster Mate. Check you’re on your home network.
          </Banner>
        )}
        <TextField
          id="username"
          label="Username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={busy}
          invalid={invalid}
        />
        <TextField
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          invalid={invalid}
          ref={passwordRef}
        />
        <Button type="submit" className="mt-2" busy={busy} disabled={!online}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-auto pt-6 text-center text-footnote text-text-faint">
        Once you’ve signed in, your shifts stay on this phone and work offline.
      </p>
    </main>
  );
}
