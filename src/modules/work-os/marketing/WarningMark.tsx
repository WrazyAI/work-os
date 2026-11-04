/** Semantic installation warning; the adjacent heading supplies its text. */
export default function WarningMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M13.5 5a2.9 2.9 0 0 1 5 0l11 19a2.9 2.9 0 0 1-2.5 4.3H5A2.9 2.9 0 0 1 2.5 24z" fill="currentColor" />
      <path d="M16 11v7" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="16" cy="23" r="1.5" fill="white" />
    </svg>
  );
}
