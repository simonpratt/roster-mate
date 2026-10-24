import { Link } from "react-router";
import { buttonClassName } from "./Button";
import { CloudOffIcon } from "./icons";

// The needs-a-connection state of a screen that talks to the server: Import's offline step
// (docs/ux-spec.md §6.4, docs/designs/Import.dc.html) and Roster emails' (§6.7,
// docs/designs/RosterEmailsOffline.dc.html). A cloud-off badge, the heading, one line, and Back
// to calendar at the bottom.
type NeedsConnectionProps = {
  title: string;
  body: string;
};

export function NeedsConnection({ title, body }: NeedsConnectionProps) {
  return (
    <section role="status" className="flex flex-1 flex-col px-6 pt-24 pb-[max(32px,env(safe-area-inset-bottom))]">
      <div className="flex flex-col items-start gap-5">
        <span className="flex size-16 items-center justify-center rounded-[20px] border border-border bg-surface text-text-muted">
          <CloudOffIcon className="size-7.5" />
        </span>
        <div className="flex flex-col gap-2.5">
          <h2 className="m-0 text-display font-bold">{title}</h2>
          <p className="m-0 text-body text-pretty text-text-muted">{body}</p>
        </div>
      </div>
      <Link to="/" className={`${buttonClassName("outline-wide")} mt-auto`}>
        Back to calendar
      </Link>
    </section>
  );
}
