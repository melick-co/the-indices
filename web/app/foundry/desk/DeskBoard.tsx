'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { HomeSection, Story } from '@/lib/story-types';
import { resolveHeroImage } from '@/lib/story-art';
import {
  pinHero,
  unpinHero,
  setHomeSection,
  reorderSection,
  setStoryStatus,
} from './actions';

function previewHref(story: Story) {
  if (story.status === 'draft') return `/stories/${story.slug}?preview=1`;
  return `/stories/${story.slug}`;
}

export default function DeskBoard({
  hero,
  frameChecks,
  stories,
  archived,
}: {
  hero: Story | null;
  frameChecks: Story[];
  stories: Story[];
  archived: Story[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function run(fn: () => Promise<void>) {
    setErr(null);
    start(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Desk save failed');
      }
    });
  }

  function move(section: Exclude<HomeSection, 'hero'>, list: Story[], index: number, dir: -1 | 1) {
    const next = index + dir;
    if (next < 0 || next >= list.length) return;
    const slugs = list.map((s) => s.slug);
    const tmp = slugs[index];
    slugs[index] = slugs[next];
    slugs[next] = tmp;
    run(() => reorderSection(section, slugs));
  }

  return (
    <div className="desk-board">
      {err && <p className="desk-error">{err}</p>}
      {pending && <p className="desk-pending">Saving…</p>}

      <section className="desk-section">
        <h2 className="section-head">Hero</h2>
        <p className="desk-note">
          Pinned story leads the home page. If none is pinned, home uses the first Frame check
          after desk order (then trend).
        </p>
        {hero ? (
          <DeskRow
            story={hero}
            pending={pending}
            onPin={() => run(() => (hero.pinnedHero ? unpinHero(hero.slug) : pinHero(hero.slug)))}
            pinLabel={hero.pinnedHero ? 'Unpin' : 'Pin hero'}
            onSection={(section) => run(() => setHomeSection(hero.slug, section))}
            onStatus={(status) => run(() => setStoryStatus(hero.slug, status))}
          />
        ) : (
          <p className="desk-empty">No hero yet. Pin a story below.</p>
        )}
      </section>

      <SectionList
        title="Frame checks"
        note="Home Frame checks rail. ▲/▼ writes home_rank. Unplaced stories still fall back to trend sort."
        section="frame_checks"
        stories={frameChecks}
        pending={pending}
        onMove={(i, d) => move('frame_checks', frameChecks, i, d)}
        onPin={(slug) => run(() => pinHero(slug))}
        onUnpin={(slug) => run(() => unpinHero(slug))}
        onSection={(slug, section) => run(() => setHomeSection(slug, section))}
        onStatus={(slug, status) => run(() => setStoryStatus(slug, status))}
      />

      <SectionList
        title="Stories"
        note="The Stories rail on home. Moving a piece here takes it off Frame checks."
        section="stories"
        stories={stories}
        pending={pending}
        onMove={(i, d) => move('stories', stories, i, d)}
        onPin={(slug) => run(() => pinHero(slug))}
        onUnpin={(slug) => run(() => unpinHero(slug))}
        onSection={(slug, section) => run(() => setHomeSection(slug, section))}
        onStatus={(slug, status) => run(() => setStoryStatus(slug, status))}
      />

      {archived.length > 0 && (
        <SectionList
          title="Archived"
          note="Off the home page. Restore by setting status back to draft or published."
          section={null}
          stories={archived}
          pending={pending}
          onMove={() => {}}
          onPin={(slug) => run(() => pinHero(slug))}
          onUnpin={(slug) => run(() => unpinHero(slug))}
          onSection={(slug, section) => run(() => setHomeSection(slug, section))}
          onStatus={(slug, status) => run(() => setStoryStatus(slug, status))}
        />
      )}
    </div>
  );
}

function SectionList({
  title,
  note,
  section,
  stories,
  pending,
  onMove,
  onPin,
  onUnpin,
  onSection,
  onStatus,
}: {
  title: string;
  note: string;
  section: Exclude<HomeSection, 'hero'> | null;
  stories: Story[];
  pending: boolean;
  onMove: (index: number, dir: -1 | 1) => void;
  onPin: (slug: string) => void;
  onUnpin: (slug: string) => void;
  onSection: (slug: string, section: HomeSection | null) => void;
  onStatus: (slug: string, status: 'draft' | 'published' | 'archived') => void;
}) {
  return (
    <section className="desk-section">
      <h2 className="section-head">{title} <span className="desk-count">{stories.length}</span></h2>
      <p className="desk-note">{note}</p>
      {stories.length === 0 && <p className="desk-empty">Nothing in this rail.</p>}
      {stories.map((story, i) => (
        <DeskRow
          key={story.slug}
          story={story}
          pending={pending}
          canMove={Boolean(section)}
          onUp={section ? () => onMove(i, -1) : undefined}
          onDown={section ? () => onMove(i, 1) : undefined}
          upDisabled={i === 0}
          downDisabled={i === stories.length - 1}
          onPin={() => (story.pinnedHero ? onUnpin(story.slug) : onPin(story.slug))}
          pinLabel={story.pinnedHero ? 'Unpin' : 'Pin hero'}
          onSection={(next) => onSection(story.slug, next)}
          onStatus={(status) => onStatus(story.slug, status)}
        />
      ))}
    </section>
  );
}

function DeskRow({
  story,
  pending,
  canMove,
  onUp,
  onDown,
  upDisabled,
  downDisabled,
  onPin,
  pinLabel,
  onSection,
  onStatus,
}: {
  story: Story;
  pending: boolean;
  canMove?: boolean;
  onUp?: () => void;
  onDown?: () => void;
  upDisabled?: boolean;
  downDisabled?: boolean;
  onPin: () => void;
  pinLabel: string;
  onSection: (section: HomeSection | null) => void;
  onStatus: (status: 'draft' | 'published' | 'archived') => void;
}) {
  const art = resolveHeroImage(story);
  const status = story.status ?? 'published';
  const placed = story.homeRank != null || story.homeSection != null || story.pinnedHero;

  return (
    <article className="desk-row">
      <div className="desk-row-art">
        {art ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={art.url} alt={art.alt} />
        ) : (
          <div className="desk-row-art-empty">No image</div>
        )}
      </div>
      <div className="desk-row-body">
        <div className="desk-row-meta">
          {story.kicker}
          {' · '}
          <span className={`desk-status desk-status-${status}`}>{status}</span>
          {story.frameCheck && ' · frame check'}
          {story.pinnedHero && ' · pinned hero'}
          {placed ? ` · desk ${story.homeSection ?? 'auto'} #${story.homeRank ?? '—'}` : ' · trend fallback'}
          {story.staticBody && ' · edit in repo'}
        </div>
        <h3 className="desk-row-title">{story.title}</h3>
        <p className="desk-row-hook">{story.hook}</p>
        <div className="desk-row-actions">
          {canMove && (
            <>
              <button type="button" className="studio-btn-outline" disabled={pending || upDisabled} onClick={onUp}>▲</button>
              <button type="button" className="studio-btn-outline" disabled={pending || downDisabled} onClick={onDown}>▼</button>
            </>
          )}
          <button type="button" className="studio-btn-outline" disabled={pending} onClick={onPin}>
            {pinLabel}
          </button>
          <select
            className="desk-select"
            disabled={pending}
            value={story.homeSection ?? ''}
            onChange={(e) => onSection((e.target.value || null) as HomeSection | null)}
          >
            <option value="">Section: auto</option>
            <option value="frame_checks">Frame checks</option>
            <option value="stories">Stories</option>
            <option value="hero">Hero rail</option>
          </select>
          {!story.staticBody && status === 'published' && (
            <button type="button" className="studio-btn-ghost" disabled={pending}
              onClick={() => onStatus('draft')}>Unpublish</button>
          )}
          {!story.staticBody && status === 'draft' && (
            <button type="button" className="studio-btn-outline" disabled={pending}
              onClick={() => onStatus('published')}>Go live</button>
          )}
          {!story.staticBody && status !== 'archived' && (
            <button type="button" className="studio-btn-ghost" disabled={pending}
              onClick={() => onStatus('archived')}>Archive</button>
          )}
          {!story.staticBody && status === 'archived' && (
            <button type="button" className="studio-btn-outline" disabled={pending}
              onClick={() => onStatus('draft')}>Restore draft</button>
          )}
          <Link href={`/foundry/desk/${story.slug}`} className="studio-link">Edit</Link>
          <Link href={previewHref(story)} className="studio-link">
            {status === 'draft' ? 'Preview' : 'View'}
          </Link>
        </div>
      </div>
    </article>
  );
}
