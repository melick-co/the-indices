import Link from 'next/link';
import { ALL_INDICES } from '@/content/indices/registry';
import { loadInstrumentCards } from '@/lib/instruments';

function ord(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export default async function IndexAgate() {
  const cards = await loadInstrumentCards().catch(() => []);
  const compact = cards.filter((c) => (
    c.id === 'ags-stock' || c.id === 'twin-stock' || c.id === 'real-wage-spread'
  ));

  const rows: { label: string; value: string; href: string }[] = [];
  for (const p of ALL_INDICES) {
    const scored = p.results.filter((r) => r.scored).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const aus = scored.find((r) => r.entity === 'AUS');
    const rank = aus ? scored.findIndex((r) => r.entity === 'AUS') + 1 : null;
    rows.push({
      label: p.index.name,
      value: aus?.score != null
        ? `${aus.score} · ${rank ? ord(rank) : '—'} of ${scored.length}`
        : '—',
      href: `/indices/${p.index.id}`,
    });
  }
  for (const c of compact) {
    rows.push({ label: c.title, value: c.headline, href: `/instruments/${c.id}` });
  }

  if (!rows.length) return null;

  return (
    <section className="agate" aria-label="Key indices">
      <div className="agate-head">
        <h2>Key indices</h2>
        <Link href="/indices">Full table</Link>
      </div>
      <ol className="agate-row">
        {rows.map((r) => (
          <li key={r.href}>
            <Link href={r.href}>
              <span className="agate-label">{r.label}</span>
              <span className="agate-value">{r.value}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
