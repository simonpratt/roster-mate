import { ChevronLeftIcon } from "./icons";

// A leaf screen's header, docs/ux-spec.md §3 and docs/designs/Import.dc.html,
// Babysitters.dc.html: a back arrow to the Calendar and the screen's title.
type ScreenHeaderProps = {
  title: string;
  onBack: () => void;
};

export function ScreenHeader({ title, onBack }: ScreenHeaderProps) {
  return (
    <header className="flex h-15 flex-none items-center gap-1 py-2 pr-4 pl-1">
      <button
        type="button"
        aria-label="Back to calendar"
        onClick={onBack}
        className="flex size-11 items-center justify-center rounded-field text-text-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <ChevronLeftIcon className="size-5.5" />
      </button>
      <h1 className="m-0 text-title">{title}</h1>
    </header>
  );
}
