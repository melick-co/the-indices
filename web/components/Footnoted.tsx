import { Fragment } from 'react';

/** Render text with [^n] markers as superscript links to the story's Sources list. */
export default function Footnoted({ text }: { text: string }) {
  const parts = text.split(/(\[\^\d+\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const n = part.match(/^\[\^(\d+)\]$/)?.[1];
        return n ? (
          <sup key={i} className="fn-ref"><a href={`#fn-${n}`} aria-label={`Source ${n}`}>{n}</a></sup>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        );
      })}
    </>
  );
}
