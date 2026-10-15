import { Link } from "react-router";
import { buttonClassName } from "../components/Button";

// Placeholder for the Import screen until SIM-16 lands.
export function Import() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-app flex-col gap-4 px-4 pt-[max(24px,env(safe-area-inset-top))]">
      <h1 className="m-0 text-title">Import</h1>
      <p className="m-0 text-body text-text-muted">Importing a roster photo is coming soon.</p>
      <Link to="/" className={`${buttonClassName("outline")} self-start`}>
        Back to calendar
      </Link>
    </main>
  );
}
