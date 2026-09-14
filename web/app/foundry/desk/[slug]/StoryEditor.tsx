'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  ChartKind,
  ChartSeriesPoint,
  HomeSection,
  SourceRow,
  Story,
  StoryArt,
  StoryBlock,
  StoryChartBlock,
} from '@/lib/story-types';
import { clipsOf, resolveHeroImage } from '@/lib/story-art';
import { saveStoryCopy, attachRenderToStory, type DeskRender, type StoryCopyPayload } from '../actions';

const BLOCK_TYPES: Array<StoryBlock['type']> = ['paragraph', 'layers', 'heading', 'pull', 'chart'];
const CHART_KINDS: ChartKind[] = ['bars', 'rank_swap', 'timeline'];

function emptyPoint(): ChartSeriesPoint {
  return { label: '', value: 0, highlight: false };
}

function emptyBlock(type: StoryBlock['type']): StoryBlock {
  if (type === 'layers') return { type: 'layers', items: [''] };
  if (type === 'heading') return { type: 'heading', text: '' };
  if (type === 'pull') return { type: 'pull', text: '' };
  if (type === 'chart') {
    return {
      type: 'chart',
      kind: 'bars',
      caption: '',
      series: [emptyPoint(), emptyPoint()],
    };
  }
  return { type: 'paragraph', text: '' };
}

function emptySource(): SourceRow {
  return { metric: '', org: '', tier: 1, url: '', period: '', basis: '' };
}

export default function StoryEditor({ story, renders = [] }: { story: Story; renders?: DeskRender[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [kicker, setKicker] = useState(story.kicker);
  const [title, setTitle] = useState(story.title);
  const [hook, setHook] = useState(story.hook);
  const [caveat, setCaveat] = useState(story.caveat);
  const [oneValue, setOneValue] = useState(story.oneNumber.value);
  const [oneLabel, setOneLabel] = useState(story.oneNumber.label);
  const [frameCheck, setFrameCheck] = useState(Boolean(story.frameCheck));
  const [published, setPublished] = useState(story.published.slice(0, 10));
  const [homeSection, setHomeSection] = useState<HomeSection | ''>(story.homeSection ?? '');
  const [heroImageUrl, setHeroImageUrl] = useState(story.heroImageUrl ?? '');
  const [heroImageAlt, setHeroImageAlt] = useState(story.heroImageAlt ?? '');
  const [uploading, setUploading] = useState(false);
  const [blocks, setBlocks] = useState<StoryBlock[]>(story.body?.blocks ?? []);
  const [tableHead, setTableHead] = useState<string[]>(story.evidence.table?.head ?? []);
  const [tableRows, setTableRows] = useState<string[][]>(story.evidence.table?.rows ?? []);
  const [sources, setSources] = useState<SourceRow[]>(
    story.evidence.sources?.length ? story.evidence.sources : [emptySource()],
  );

  const readOnlyCopy = Boolean(story.staticBody);
  const previewHref = story.status === 'draft'
    ? `/stories/${story.slug}?preview=1`
    : `/stories/${story.slug}`;
  const resolved = resolveHeroImage({
    title, heroImageUrl: heroImageUrl || null, heroImageAlt: heroImageAlt || null, art: story.art,
  });
  const clips = clipsOf(story);
  const stills = (story.art ?? []).filter((a) => a.kind !== 'clip');

  const payload: StoryCopyPayload = useMemo(() => ({
    kicker,
    title,
    hook,
    caveat,
    oneNumber: { value: oneValue, label: oneLabel },
    frameCheck,
    published,
    body: { blocks },
    evidence: {
      table: tableHead.some((h) => h.trim()) ? { head: tableHead, rows: tableRows } : undefined,
      sources,
    },
    heroImageUrl: heroImageUrl || null,
    heroImageAlt: heroImageAlt || null,
    homeSection: (homeSection || null) as HomeSection | null,
  }), [
    kicker, title, hook, caveat, oneValue, oneLabel, frameCheck, published,
    blocks, tableHead, tableRows, sources, heroImageUrl, heroImageAlt, homeSection,
  ]);

  function save() {
    setErr(null);
    setOk(null);
    start(async () => {
      try {
        const result = await saveStoryCopy(story.slug, payload);
        setOk(result.staticBody
          ? 'Saved image and placement. Copy for this story is edited in the repo.'
          : 'Saved.');
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Save failed');
      }
    });
  }

  async function uploadFile(file: File) {
    setUploading(true);
    setErr(null);
    try {
      const form = new FormData();
      form.set('slug', story.slug);
      form.set('file', file);
      form.set('alt', heroImageAlt || title);
      const res = await fetch('/api/foundry/desk/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Upload failed (${res.status})`);
      setHeroImageUrl(data.url);
      if (data.alt) setHeroImageAlt(data.alt);
      setOk('Image uploaded.');
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function setBlock(i: number, next: StoryBlock) {
    setBlocks((b) => b.map((block, idx) => (idx === i ? next : block)));
  }

  return (
    <div className="desk-editor">
      <div className="desk-editor-head">
        <h1 className="section-head" style={{ borderBottom: 'none', marginBottom: 0 }}>{title || story.slug}</h1>
        <div className="desk-row-actions">
          <Link href={previewHref} className="studio-link">
            {story.status === 'draft' ? 'Preview draft' : 'View story'}
          </Link>
          <Link href={`/stories/${story.slug}/reel`} className="studio-link">Reel</Link>
          <button type="button" className="studio-btn-outline" disabled={pending} onClick={save}>
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {err && <p className="desk-error">{err}</p>}
      {ok && <p className="desk-ok">{ok}</p>}

      {readOnlyCopy && (
        <div className="caveat-box">
          <h3>Edit in repo</h3>
          <p style={{ marginBottom: 0 }}>
            This founding story has no <code>body.blocks</code>. Copy and charts live in
            {' '}<code>web/content/stories.ts</code> and
            {' '}<code>web/app/stories/[slug]/bodies/</code>.
            You can still pin it, place it on home, and attach a hero image from this desk.
          </p>
        </div>
      )}

      <fieldset className="desk-fieldset" disabled={readOnlyCopy}>
        <legend>Card copy</legend>
        <label className="desk-label">Kicker
          <input className="studio-field" value={kicker} onChange={(e) => setKicker(e.target.value)} />
        </label>
        <label className="desk-label">Title
          <input className="studio-field" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="desk-label">Hook
          <textarea className="studio-field" rows={3} value={hook} onChange={(e) => setHook(e.target.value)} />
        </label>
        <label className="desk-label">Caveat
          <textarea className="studio-field" rows={3} value={caveat} onChange={(e) => setCaveat(e.target.value)} />
        </label>
        <div className="desk-split">
          <label className="desk-label">One number
            <input className="studio-field" value={oneValue} onChange={(e) => setOneValue(e.target.value)} />
          </label>
          <label className="desk-label">One number label
            <input className="studio-field" value={oneLabel} onChange={(e) => setOneLabel(e.target.value)} />
          </label>
        </div>
        <div className="desk-split">
          <label className="desk-label">Published
            <input className="studio-field" type="date" value={published} onChange={(e) => setPublished(e.target.value)} />
          </label>
          <label className="desk-check">
            <input type="checkbox" checked={frameCheck} onChange={(e) => setFrameCheck(e.target.checked)} />
            Frame check
          </label>
        </div>
      </fieldset>

      <fieldset className="desk-fieldset">
        <legend>Home placement</legend>
        <label className="desk-label">Section
          <select className="desk-select" value={homeSection} onChange={(e) => setHomeSection(e.target.value as HomeSection | '')}>
            <option value="">Auto (from frame check, then trend)</option>
            <option value="frame_checks">Frame checks</option>
            <option value="stories">Stories</option>
            <option value="hero">Hero rail</option>
          </select>
        </label>
      </fieldset>

      <fieldset className="desk-fieldset">
        <legend>Image</legend>
        {resolved && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="desk-preview-art" src={resolved.url} alt={resolved.alt} />
        )}
        <label className="desk-label">Hero / card image URL
          <input className="studio-field" value={heroImageUrl} onChange={(e) => setHeroImageUrl(e.target.value)}
            placeholder="https://…" />
        </label>
        <label className="desk-label">Alt text
          <input className="studio-field" value={heroImageAlt} onChange={(e) => setHeroImageAlt(e.target.value)} />
        </label>
        <label className="desk-label">Upload to storage
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadFile(file);
            }}
          />
        </label>
        <p className="desk-note">
          Uploads go to the public <code>story-art</code> bucket. A URL field is enough if you
          already host the file.
        </p>
        <ArtList title="Attached stills" items={stills} />
        <ArtList title="Attached clips" items={clips} empty="No generated clips attached yet." />
        {renders.length > 0 && (
          <div className="desk-art-list">
            <div className="desk-row-meta">Generated stills / clips (from the reel renderer)</div>
            <p className="desk-note">
              These already exist on the story&apos;s reel. Attach one as card art. The desk
              does not start a Runway job.
            </p>
            {renders.map((r) => (
              <div key={r.renderId} className="desk-art-item">
                <span className="desk-row-meta">{r.kind}</span>
                <a href={r.url} className="studio-link" target="_blank" rel="noreferrer">Open</a>
                {(r.kind === 'still' || r.kind === 'chart' || r.kind === 'hero') && (
                  <button type="button" className="studio-btn-ghost" disabled={pending}
                    onClick={() => {
                      setErr(null);
                      start(async () => {
                        try {
                          await attachRenderToStory(story.slug, r, true);
                          setHeroImageUrl(r.url);
                          setOk('Attached as hero image.');
                          router.refresh();
                        } catch (e) {
                          setErr(e instanceof Error ? e.message : 'Attach failed');
                        }
                      });
                    }}>
                    Use as hero
                  </button>
                )}
                {(r.kind === 'clip' || r.kind === 'chart_video' || r.kind === 'reel') && (
                  <button type="button" className="studio-btn-ghost" disabled={pending}
                    onClick={() => {
                      setErr(null);
                      start(async () => {
                        try {
                          await attachRenderToStory(story.slug, r, false);
                          setOk('Clip attached to the story.');
                          router.refresh();
                        } catch (e) {
                          setErr(e instanceof Error ? e.message : 'Attach failed');
                        }
                      });
                    }}>
                    Attach clip
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </fieldset>

      {!readOnlyCopy && (
        <>
          <fieldset className="desk-fieldset">
            <legend>Body blocks</legend>
            <p className="desk-note">
              Chart series stay editor-entered numbers drawn from the evidence. The desk will
              not compute a figure for you.
            </p>
            {blocks.map((block, i) => (
              <div key={i} className="desk-block">
                <div className="desk-block-bar">
                  <span className="desk-row-meta">{block.type}</span>
                  <button type="button" className="studio-btn-ghost" onClick={() => setBlocks((b) => {
                    if (i === 0) return b;
                    const next = [...b];
                    [next[i - 1], next[i]] = [next[i], next[i - 1]];
                    return next;
                  })}>▲</button>
                  <button type="button" className="studio-btn-ghost" onClick={() => setBlocks((b) => {
                    if (i === b.length - 1) return b;
                    const next = [...b];
                    [next[i + 1], next[i]] = [next[i], next[i + 1]];
                    return next;
                  })}>▼</button>
                  <button type="button" className="studio-btn-ghost" onClick={() => setBlocks((b) => b.filter((_, idx) => idx !== i))}>
                    Remove
                  </button>
                </div>
                <BlockFields block={block} onChange={(next) => setBlock(i, next)} />
              </div>
            ))}
            <div className="desk-row-actions">
              {BLOCK_TYPES.map((type) => (
                <button key={type} type="button" className="studio-btn-outline"
                  onClick={() => setBlocks((b) => [...b, emptyBlock(type)])}>
                  + {type}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="desk-fieldset">
            <legend>Evidence table</legend>
            <div className="desk-table-scroll">
              <table className="data desk-table">
                <thead>
                  <tr>
                    {tableHead.map((h, i) => (
                      <th key={i}>
                        <input className="studio-field" value={h} onChange={(e) => {
                          const v = e.target.value;
                          setTableHead((head) => head.map((x, idx) => (idx === i ? v : x)));
                        }} />
                      </th>
                    ))}
                    <th>
                      <button type="button" className="studio-btn-ghost" onClick={() => {
                        setTableHead((h) => [...h, '']);
                        setTableRows((rows) => rows.map((r) => [...r, '']));
                      }}>+ col</button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, ri) => (
                    <tr key={ri}>
                      {tableHead.map((_, ci) => (
                        <td key={ci}>
                          <input className="studio-field" value={row[ci] ?? ''} onChange={(e) => {
                            const v = e.target.value;
                            setTableRows((rows) => rows.map((r, idx) => {
                              if (idx !== ri) return r;
                              const next = [...r];
                              while (next.length < tableHead.length) next.push('');
                              next[ci] = v;
                              return next;
                            }));
                          }} />
                        </td>
                      ))}
                      <td>
                        <button type="button" className="studio-btn-ghost"
                          onClick={() => setTableRows((rows) => rows.filter((_, idx) => idx !== ri))}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className="studio-btn-outline" onClick={() => {
              if (!tableHead.length) setTableHead(['']);
              setTableRows((rows) => [...rows, tableHead.map(() => '')]);
            }}>+ row</button>
          </fieldset>

          <fieldset className="desk-fieldset">
            <legend>Sources</legend>
            {sources.map((s, i) => (
              <div key={i} className="desk-source">
                <div className="desk-split">
                  <label className="desk-label">Metric
                    <input className="studio-field" value={s.metric} onChange={(e) => setSources((all) => all.map((x, idx) => idx === i ? { ...x, metric: e.target.value } : x))} />
                  </label>
                  <label className="desk-label">Org
                    <input className="studio-field" value={s.org} onChange={(e) => setSources((all) => all.map((x, idx) => idx === i ? { ...x, org: e.target.value } : x))} />
                  </label>
                  <label className="desk-label">Tier
                    <select className="desk-select" value={s.tier} onChange={(e) => setSources((all) => all.map((x, idx) => idx === i ? { ...x, tier: Number(e.target.value) as 1 | 2 | 3 } : x))}>
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                      <option value={3}>3</option>
                    </select>
                  </label>
                </div>
                <label className="desk-label">URL
                  <input className="studio-field" value={s.url} onChange={(e) => setSources((all) => all.map((x, idx) => idx === i ? { ...x, url: e.target.value } : x))} />
                </label>
                <div className="desk-split">
                  <label className="desk-label">Period
                    <input className="studio-field" value={s.period} onChange={(e) => setSources((all) => all.map((x, idx) => idx === i ? { ...x, period: e.target.value } : x))} />
                  </label>
                  <label className="desk-label">Basis
                    <input className="studio-field" value={s.basis} onChange={(e) => setSources((all) => all.map((x, idx) => idx === i ? { ...x, basis: e.target.value } : x))} />
                  </label>
                </div>
                <button type="button" className="studio-btn-ghost" onClick={() => setSources((all) => all.filter((_, idx) => idx !== i))}>
                  Remove source
                </button>
              </div>
            ))}
            <button type="button" className="studio-btn-outline" onClick={() => setSources((all) => [...all, emptySource()])}>
              + source
            </button>
          </fieldset>
        </>
      )}

      <div className="desk-row-actions" style={{ marginTop: 'var(--spacing-42)' }}>
        <button type="button" className="studio-btn-outline" disabled={pending} onClick={save}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <Link href="/foundry/desk" className="studio-link">Back to desk</Link>
      </div>
    </div>
  );
}

function ArtList({ title, items, empty }: { title: string; items: StoryArt[]; empty?: string }) {
  return (
    <div className="desk-art-list">
      <div className="desk-row-meta">{title}</div>
      {!items.length && <p className="desk-note">{empty ?? 'None attached.'}</p>}
      {items.map((a) => (
        <div key={a.id} className="desk-art-item">
          <span className="desk-row-meta">{a.kind} · {a.source}{a.generator ? ` · ${a.generator}` : ''}</span>
          <a href={a.url} className="studio-link" target="_blank" rel="noreferrer">{a.url}</a>
        </div>
      ))}
    </div>
  );
}

function BlockFields({ block, onChange }: { block: StoryBlock; onChange: (b: StoryBlock) => void }) {
  if (block.type === 'layers') {
    return (
      <div>
        {block.items.map((item, i) => (
          <textarea
            key={i}
            className="studio-field"
            rows={2}
            value={item}
            onChange={(e) => {
              const items = block.items.map((t, idx) => (idx === i ? e.target.value : t));
              onChange({ type: 'layers', items });
            }}
          />
        ))}
        <div className="desk-row-actions">
          <button type="button" className="studio-btn-ghost"
            onClick={() => onChange({ type: 'layers', items: [...block.items, ''] })}>+ layer</button>
        </div>
      </div>
    );
  }
  if (block.type === 'chart') return <ChartFields chart={block} onChange={onChange} />;
  return (
    <textarea
      className="studio-field"
      rows={block.type === 'paragraph' ? 5 : 2}
      value={block.text}
      onChange={(e) => onChange({ ...block, text: e.target.value })}
    />
  );
}

function ChartFields({
  chart,
  onChange,
}: {
  chart: StoryChartBlock;
  onChange: (b: StoryChartBlock) => void;
}) {
  function setSeries(which: 'series' | 'alt_series', points: ChartSeriesPoint[]) {
    onChange({ ...chart, [which]: points });
  }

  return (
    <div>
      <div className="desk-split">
        <label className="desk-label">Kind
          <select className="desk-select" value={chart.kind}
            onChange={(e) => onChange({ ...chart, kind: e.target.value as ChartKind })}>
            {CHART_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label className="desk-label">Title
          <input className="studio-field" value={chart.title ?? ''}
            onChange={(e) => onChange({ ...chart, title: e.target.value })} />
        </label>
      </div>
      <label className="desk-label">Caption (source line)
        <input className="studio-field" value={chart.caption ?? ''}
          onChange={(e) => onChange({ ...chart, caption: e.target.value })} />
      </label>
      {chart.kind === 'rank_swap' && (
        <div className="desk-split">
          <label className="desk-label">Primary label
            <input className="studio-field" value={chart.primary_label ?? ''}
              onChange={(e) => onChange({ ...chart, primary_label: e.target.value })} />
          </label>
          <label className="desk-label">Alt label
            <input className="studio-field" value={chart.alt_label ?? ''}
              onChange={(e) => onChange({ ...chart, alt_label: e.target.value })} />
          </label>
        </div>
      )}
      <SeriesEditor label="Series" points={chart.series} onChange={(p) => setSeries('series', p)} />
      {chart.kind === 'rank_swap' && (
        <SeriesEditor
          label="Alt series"
          points={chart.alt_series ?? []}
          onChange={(p) => setSeries('alt_series', p)}
        />
      )}
    </div>
  );
}

function SeriesEditor({
  label,
  points,
  onChange,
}: {
  label: string;
  points: ChartSeriesPoint[];
  onChange: (p: ChartSeriesPoint[]) => void;
}) {
  return (
    <div className="desk-series">
      <div className="desk-row-meta">{label}</div>
      {points.map((p, i) => (
        <div key={i} className="desk-split desk-series-row">
          <input className="studio-field" placeholder="Label" value={p.label}
            onChange={(e) => onChange(points.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))} />
          <input className="studio-field" placeholder="Value" type="number" step="any" value={Number.isFinite(p.value) ? p.value : ''}
            onChange={(e) => onChange(points.map((x, idx) => idx === i ? { ...x, value: Number(e.target.value) } : x))} />
          <label className="desk-check">
            <input type="checkbox" checked={Boolean(p.highlight)}
              onChange={(e) => onChange(points.map((x, idx) => idx === i ? { ...x, highlight: e.target.checked } : x))} />
            Highlight
          </label>
          <button type="button" className="studio-btn-ghost"
            onClick={() => onChange(points.filter((_, idx) => idx !== i))}>Remove</button>
        </div>
      ))}
      <button type="button" className="studio-btn-ghost" onClick={() => onChange([...points, emptyPoint()])}>
        + point
      </button>
    </div>
  );
}
