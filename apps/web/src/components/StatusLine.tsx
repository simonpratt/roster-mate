// A one-line status with a dot, docs/ux-spec.md §6.7 (the Roster emails screen's last-send line,
// docs/designs/RosterEmails.dc.html and RosterEmailsFailed.dc.html): an 8 px dot, then the text,
// in text-muted with an ok dot, or all in danger. role="status" announces a change politely.
type StatusLineProps = {
  tone: "ok" | "danger";
  text: string;
  className?: string;
};

export function StatusLine({ tone, text, className = "" }: StatusLineProps) {
  const danger = tone === "danger";
  return (
    <p role="status" className={`m-0 flex items-center gap-2 text-footnote ${danger ? "text-danger" : "text-text-muted"} ${className}`}>
      <span aria-hidden="true" className={`size-2 flex-none rounded-full ${danger ? "bg-danger" : "bg-ok"}`} />
      <span>{text}</span>
    </p>
  );
}
