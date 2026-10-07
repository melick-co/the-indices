'use client';

import { useMemo, useState, useTransition } from 'react';
import { CHANNELS, WEEKDAYS, type Channel, type QueueItem, type QueueKind, type QueuePost, type ScheduleRules } from '@/lib/content-queue';
import { planNow, publishNow, reschedule, saveRules, setStatus } from './actions';

const KIND_LABEL: Record<QueueKind, string> = { article: 'Article', visual: 'Graphic', race: 'Race video', breaking: 'Breaking', hero_video: 'Hero video', reel: 'Reel' };
const CHANNEL_LABEL: Record<Channel, string> = { site: 'Site', youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', x: 'X', linkedin: 'LinkedIn' };
const POST_LABEL: Record<string, string> = { planned: 'planned', scheduled: 'scheduled', posted: 'posted', failed: 'failed', skipped: 'skipped', not_connected: 'not connected' };
const PLANNED_KINDS: QueueKind[] = ['article', 'visual', 'race'];

function useTz(tz: string) {
  return useMemo(() => ({
    day: (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz }),
    dayLabel: (iso: string) => new Date(iso).toLocaleDateString('en-AU', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }),
    time: (iso: string) => new Date(iso).toLocaleTimeString('en-AU', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    /** The value for a datetime-local input, in the rules' time zone. */
    local: (iso: string) => {
      const d = new Date(iso);
      return `${d.toLocaleDateString('en-CA', { timeZone: tz })}T${d.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`;
    },
  }), [tz]);
}

type Ctx = {
  t: ReturnType<typeof useTz>; rules: ScheduleRules; pending: boolean;
  run: (fn: () => Promise<unknown>, done?: string) => void; postsOf: (id: string) => QueuePost[];
};

const previewUrl = (i: QueueItem) => (i.kind === 'visual' || i.kind === 'race' ? `/indices/visuals/${i.ref_slug}` : `/stories/${i.ref_slug}`) + (i.status === 'published' ? '' : '?preview=1');

export default function QueueBoard({ rules, items, posts }: { rules: ScheduleRules; items: QueueItem[]; posts: QueuePost[] }) {
  const t = useTz(rules.timezone);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [planLog, setPlanLog] = useState<string[] | null>(null);
  const [showRules, setShowRules] = useState(false);
  const run = (fn: () => Promise<unknown>, done?: string) => start(async () => {
    setMsg(null);
    try { await fn(); if (done) setMsg(done); } catch (e) { setMsg(e instanceof Error ? e.message : 'That did not work.'); }
  });
  const postsOf = (id: string) => posts.filter((p) => p.queue_id === id).sort((a, b) => CHANNELS.indexOf(a.channel) - CHANNELS.indexOf(b.channel));

  const scheduled = items.filter((i) => i.status === 'scheduled' && i.scheduled_at);
  const ready = items.filter((i) => i.status === 'ready');
  const stuck = items.filter((i) => i.status === 'held' || i.status === 'failed');
  const published = items.filter((i) => i.status === 'published');
  // The calendar: today and the horizon, each day's pieces in time order.
  const days = useMemo(() => {
    const today = t.day(new Date().toISOString());
    const out: { key: string; label: string; items: QueueItem[] }[] = [];
    for (let n = 0; n <= rules.horizonDays; n++) {
      const iso = new Date(Date.parse(`${today}T12:00:00Z`) + n * 864e5).toISOString();
      const key = iso.slice(0, 10);
      out.push({ key, label: n === 0 ? `Today, ${t.dayLabel(iso)}` : t.dayLabel(iso), items: scheduled.filter((i) => t.day(i.scheduled_at!) === key).sort((a, b) => a.scheduled_at!.localeCompare(b.scheduled_at!)) });
    }
    return out;
  }, [scheduled, rules.horizonDays, t]);
  const later = scheduled.filter((i) => !days.some((d) => d.key === t.day(i.scheduled_at!)));

  const ctx: Ctx = { t, rules, pending, run, postsOf };
  const capText = (k: QueueKind) => {
    const c = rules.caps[k] ?? {};
    const cap = c.perDay != null ? `${c.perDay} a day` : c.perWeek != null ? `${c.perWeek} a week` : 'no cap';
    const d = rules.days?.[k]?.length ? `, ${rules.days[k]!.map((x) => x[0].toUpperCase() + x.slice(1)).join('/')}` : '';
    return `${KIND_LABEL[k]}s: ${cap} at ${(rules.slots[k] ?? []).join(', ') || 'no set time'}${d}`;
  };

  return (
    <div className="pq">
      <div className="pq-bar">
        <span className={`pq-state ${rules.enabled ? 'on' : 'off'}`}>{rules.enabled ? 'Queue on' : 'Queue off: generators publish at once'}</span>
        <span className="pq-rules-line">{PLANNED_KINDS.map(capText).join(' · ')} · at least {rules.minGapMinutes} min apart · {rules.eventBufferMinutes} min clear of data releases</span>
        <span className="pq-bar-actions">
          <button type="button" className="pq-btn primary" disabled={pending || !rules.enabled} onClick={() => run(async () => setPlanLog(await planNow()))}>{pending ? 'Working…' : 'Plan now'}</button>
          <button type="button" className="pq-btn" onClick={() => setShowRules((v) => !v)}>{showRules ? 'Close rules' : 'Rules'}</button>
        </span>
      </div>
      {msg && <p className="pq-msg">{msg}</p>}
      {planLog && <pre className="pq-log">{planLog.length ? planLog.join('\n') : 'Nothing ready to schedule.'}</pre>}
      {showRules && <RulesForm rules={rules} onSave={(r) => run(() => saveRules(r), 'Rules saved.')} pending={pending} />}

      <section>
        <h2 className="pq-h">Calendar</h2>
        <div className="pq-cal">
          {days.map((d) => (
            <div key={d.key} className="pq-day">
              <div className="pq-day-head">{d.label}</div>
              {d.items.length ? d.items.map((i) => (
                <a key={i.id} href={`#q-${i.id}`} className={`pq-slot k-${i.kind}`}>
                  <span className="pq-slot-time">{t.time(i.scheduled_at!)}</span>
                  <span className="pq-slot-title">{i.title}</span>
                </a>
              )) : <span className="pq-empty">—</span>}
            </div>
          ))}
        </div>
      </section>

      <List {...ctx} title={`Scheduled (${scheduled.length})`} items={[...days.flatMap((d) => d.items), ...later]} />
      <List {...ctx} title={`Ready, waiting for a slot (${ready.length})`} items={ready} empty="Nothing waiting." />
      {stuck.length > 0 && <List {...ctx} title={`Held or failed (${stuck.length})`} items={stuck} />}
      <List {...ctx} title={`Published in the last 14 days (${published.length})`} items={published} empty="Nothing published through the queue yet." />
    </div>
  );
}

function List({ title, items: list, empty, ...ctx }: Ctx & { title: string; items: QueueItem[]; empty?: string }) {
  return (
    <section>
      <h2 className="pq-h">{title}</h2>
      {list.length ? <div className="pq-list">{list.map((i) => <Row key={i.id} i={i} {...ctx} />)}</div> : empty ? <p className="pq-empty">{empty}</p> : null}
    </section>
  );
}

function Row({ i, t, rules, pending, run, postsOf }: Ctx & { i: QueueItem }) {
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState(i.scheduled_at ? t.local(i.scheduled_at) : '');
  const p = postsOf(i.id);
  const live = i.status === 'published';
  return (
    <article id={`q-${i.id}`} className={`pq-row s-${i.status}`}>
      <div className="pq-row-main">
        <span className={`pq-kind k-${i.kind}`}>{KIND_LABEL[i.kind]}</span>
        <div className="pq-row-text">
          <a className="pq-title" href={previewUrl(i)} target="_blank" rel="noreferrer">{i.title}</a>
          <div className="pq-meta">
            {live ? `Published ${t.dayLabel(i.published_at!)}, ${t.time(i.published_at!)}`
              : i.scheduled_at ? `${i.status === 'held' ? 'Held, was' : 'Scheduled'} ${t.dayLabel(i.scheduled_at)}, ${t.time(i.scheduled_at)} · ${i.scheduled_by === 'editor' ? 'set by you' : 'set by the assistant'}`
              : i.status === 'failed' ? `Failed: ${i.error ?? 'unknown error'}` : `Ready since ${t.dayLabel(i.created_at)}`}
          </div>
          {p.length > 0 && (
            <div className="pq-chans">
              {p.map((x) => <span key={x.channel} className={`pq-chan c-${x.status}`} title={x.error ?? POST_LABEL[x.status]}>{CHANNEL_LABEL[x.channel]} · {POST_LABEL[x.status]}</span>)}
            </div>
          )}
        </div>
        <button type="button" className="pq-btn small" onClick={() => setOpen((v) => !v)}>{open ? 'Less' : 'More'}</button>
      </div>
      {open && (
        <div className="pq-detail">
          {i.reason && <p className="pq-reason"><strong>Assistant:</strong> {i.reason}</p>}
          {i.summary && <p className="pq-summary">{i.summary}</p>}
          {p.filter((x) => x.caption).map((x) => <p key={x.channel} className="pq-caption"><strong>{CHANNEL_LABEL[x.channel]}:</strong> {x.caption}</p>)}
          {!live && (
            <div className="pq-actions">
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="pq-input" aria-label={`Time for ${i.title} (${rules.timezone})`} />
              <button type="button" className="pq-btn" disabled={pending || !when} onClick={() => run(() => reschedule(i.id, when), 'Scheduled.')}>Schedule</button>
              <button type="button" className="pq-btn" disabled={pending} onClick={() => { if (confirm(`Publish "${i.title}" now? It goes live within five minutes.`)) run(() => publishNow(i.id), 'Publishing within five minutes.'); }}>Publish now</button>
              {i.status !== 'held' && <button type="button" className="pq-btn" disabled={pending} onClick={() => run(() => setStatus(i.id, 'held'), 'Held.')}>Hold</button>}
              {(i.status === 'held' || i.status === 'scheduled' || i.status === 'failed') && <button type="button" className="pq-btn" disabled={pending} onClick={() => run(() => setStatus(i.id, 'ready'), 'Back to ready.')}>Back to ready</button>}
              <button type="button" className="pq-btn danger" disabled={pending} onClick={() => { if (confirm(`Take "${i.title}" out of the queue? It stays a draft.`)) run(() => setStatus(i.id, 'cancelled'), 'Taken out of the queue.'); }}>Remove</button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function RulesForm({ rules, onSave, pending }: { rules: ScheduleRules; onSave: (r: ScheduleRules) => void; pending: boolean }) {
  const [r, setR] = useState<ScheduleRules>(() => JSON.parse(JSON.stringify(rules)));
  const set = (patch: Partial<ScheduleRules>) => setR((x) => ({ ...x, ...patch }));
  return (
    <form className="pq-rules" onSubmit={(e) => { e.preventDefault(); onSave(r); }}>
      <label className="pq-check"><input type="checkbox" checked={r.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Queue on (off: generators publish as soon as a piece is made)</label>
      <div className="pq-rules-grid">
        <label>Plan ahead (days)<input className="pq-input" type="number" min={1} max={30} value={r.horizonDays} onChange={(e) => set({ horizonDays: Number(e.target.value) })} /></label>
        <label>Minimum gap (minutes)<input className="pq-input" type="number" min={0} value={r.minGapMinutes} onChange={(e) => set({ minGapMinutes: Number(e.target.value) })} /></label>
        <label>Clear of data releases (minutes)<input className="pq-input" type="number" min={0} value={r.eventBufferMinutes} onChange={(e) => set({ eventBufferMinutes: Number(e.target.value) })} /></label>
      </div>
      {PLANNED_KINDS.map((k) => {
        const cap = r.caps[k] ?? {};
        const per = cap.perWeek != null ? 'week' : 'day';
        return (
          <fieldset key={k} className="pq-kind-rules">
            <legend>{KIND_LABEL[k]}s</legend>
            <label>At most
              <input className="pq-input narrow" type="number" min={0} value={(per === 'week' ? cap.perWeek : cap.perDay) ?? 0}
                onChange={(e) => set({ caps: { ...r.caps, [k]: per === 'week' ? { perWeek: Number(e.target.value) } : { perDay: Number(e.target.value) } } })} />
              <select className="pq-input narrow" value={per} onChange={(e) => set({ caps: { ...r.caps, [k]: e.target.value === 'week' ? { perWeek: cap.perDay ?? cap.perWeek ?? 1 } : { perDay: cap.perWeek ?? cap.perDay ?? 1 } } })}>
                <option value="day">a day</option><option value="week">a week</option>
              </select>
            </label>
            <label>Times (Sydney, comma separated)
              <input className="pq-input" value={(r.slots[k] ?? []).join(', ')} onChange={(e) => set({ slots: { ...r.slots, [k]: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })} />
            </label>
            <div className="pq-days">On
              {WEEKDAYS.map((d) => {
                const on = !(r.days?.[k]?.length) || r.days[k]!.includes(d);
                return (
                  <label key={d} className="pq-check"><input type="checkbox" checked={on} onChange={(e) => {
                    const cur = r.days?.[k]?.length ? r.days[k]! : [...WEEKDAYS];
                    const next = e.target.checked ? [...cur, d] : cur.filter((x) => x !== d);
                    set({ days: { ...r.days, [k]: next.length === 7 ? [] : WEEKDAYS.filter((x) => next.includes(x)) } });
                  }} />{d[0].toUpperCase() + d.slice(1)}</label>
                );
              })}
            </div>
            <div className="pq-days">Channels
              {CHANNELS.map((c) => (
                <label key={c} className="pq-check"><input type="checkbox" checked={(r.channels[k] ?? []).includes(c)} disabled={c === 'site'} onChange={(e) => {
                  const cur = r.channels[k] ?? ['site'];
                  set({ channels: { ...r.channels, [k]: CHANNELS.filter((x) => x === 'site' || (x === c ? e.target.checked : cur.includes(x))) } });
                }} />{CHANNEL_LABEL[c]}</label>
              ))}
            </div>
          </fieldset>
        );
      })}
      <button type="submit" className="pq-btn primary" disabled={pending}>Save rules</button>
    </form>
  );
}
