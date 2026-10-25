/** A small "?" that explains a number on hover, or on tap (focus) on phones. */
export function Hint({ text }: { text: string }) {
  return (
    <span className="hint" tabIndex={0} role="note" aria-label={text} data-tip={text}>
      ?
    </span>
  );
}
