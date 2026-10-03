import { Fragment } from 'react';

/**
 * Render text with [^n] markers as superscript links to the story's Sources list. Adjacent markers are
 * separated by a comma, so [^2][^3] reads as 2,3 rather than 23.
 */
export default function Footnoted({ text }: { text: string }) {
  const parts = text.split(/(\[\^\d+\])/g);
  let afterMarker = false;
  return (
    <>
      {parts.map((part, i) => {
        const n = part.match(/^\[\^(\d+)\]$/)?.[1];
        if (!n) {
          if (part) afterMarker = false;
          return <Fragment key={i}>{part}</Fragment>;
        }
        const comma = afterMarker;
        afterMarker = true;
        return (
          <sup key={i} className="fn-ref">{comma ? ',' : ''}<a href={`#fn-${n}`} aria-label={`Source ${n}`}>{n}</a></sup>
        );
      })}
    </>
  );
}
