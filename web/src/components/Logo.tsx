// The Roster Mate mark from docs/designs/Login.dc.html: a 2x2 grid of Day, Early and Late chips
// and an outlined Day off. Its fills are artwork (the same glyph as the app icon), so they are
// fixed here rather than theme tokens.
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 30 30" aria-hidden="true" className={className}>
      <rect x="1" y="1" width="28" height="28" rx="8" fill="#161920" stroke="#2A2F38" />
      <rect x="7" y="7" width="7" height="7" rx="2" fill="#FCC35A" />
      <rect x="16" y="7" width="7" height="7" rx="2" fill="#7DD3FC" />
      <rect x="7" y="16" width="7" height="7" rx="2" fill="#C9B6FD" />
      <rect x="16" y="16" width="7" height="7" rx="2" fill="none" stroke="#5A616D" strokeWidth="1.5" />
    </svg>
  );
}
