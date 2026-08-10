import { createClient } from '@/lib/supabase-server';

/** Curated headlines. Reads only rows marked curated, which is the sole table
 *  the public policy exposes. Silent when empty rather than showing a gap. */
export default async function Ticker() {
  let items: any[] = [];
  try {
    const supabase = createClient();
    const { data } = await supabase.from('rss_items')
      .select('item_id, title, link, curated_note, published_at')
      .eq('curated', true).order('published_at', { ascending: false }).limit(12);
    items = data ?? [];
  } catch { return null; }
  if (!items.length) return null;

  const run = [...items, ...items]; // duplicated for a seamless loop

  return (
    <div className="ticker" aria-label="Curated headlines">
      <div className="ticker-label">On the wire</div>
      <div className="ticker-viewport">
        <div className="ticker-track">
          {run.map((it, i) => (
            <a key={`${it.item_id}-${i}`} href={it.link ?? '#'} target="_blank"
              rel="noreferrer" className="ticker-item">
              {it.curated_note && <span className="ticker-note">{it.curated_note}</span>}
              {it.title}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
