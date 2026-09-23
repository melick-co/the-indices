import Link from 'next/link';
import type { RubSelection } from '@/lib/the-rub';

export default function TheRub({ selection }: { selection: RubSelection }) {
  const { rub, peg, matched } = selection;
  return (
    <aside className="the-rub" aria-labelledby="the-rub-title">
      <p className="the-rub-flag">Column 8</p>
      <h2 id="the-rub-title" className="the-rub-name">
        <Link href={`/the-rub/${rub.slug}`}>The Rub</Link>
      </h2>
      <p className="the-rub-hed">{rub.title}</p>
      {matched && peg && (
        <p className="the-rub-peg">On the wire: {peg}</p>
      )}
      {rub.paragraphs.slice(0, 3).map((p) => (
        <p key={p.slice(0, 24)} className="the-rub-p">{p}</p>
      ))}
      <p className="the-rub-more">
        <Link href={`/the-rub/${rub.slug}`}>Continue</Link>
      </p>
    </aside>
  );
}
