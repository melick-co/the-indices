# caveat-web

The public face of Caveat. Static, fast, and it never touches the database.

## What's here

| Route | What |
|---|---|
| `/` | Masthead, the hero flip (signature element), story cards showing each story's caveat up front |
| `/stories/[slug]` | Story pages with layered build and embedded interactive figures |
| `/evidence/[slug]` | The receipts: the one number, the data table, the source table with tiers and links |
| `/methodology` | How Caveat works, published in full |
| `/api/subscribe` | Email capture (Resend when configured, logs otherwise) |

## The design

Palette derives from the subject: sub-editor's markup. Paper stock (`--paper`),
ink, editor's red (`--pen`) reserved strictly for caveats and corrections, and a
highlighter yellow (`--highlight`) used only on the figure that actually matters.
That last one is a deliberate inversion: the viral posts we correct highlight the
claim; we highlight the number that changes it.

Type: Fraunces (display, characterful serif), Source Serif 4 (body, editorial),
IBM Plex Mono (data, sources, tiers — mono signals machine-checkable).

The signature element is the hero: a claim as everyone read it, then the
correction in red pen. Everything else stays quiet.

## Architecture

**Public pages are fully static.** They read from `content/stories.ts`, not from
Supabase, so the database stays private behind RLS and the site is fast and
indexable. The `middleware.ts` here gates only `/studio` — the opposite of the
indices-web middleware, which gated everything.

Stories live in the repo as data + a body component, so git history is the
public changelog. This suits the immutable-vintage rule: published pages don't
change quietly.

## Setup

```bash
npm install
npm run dev          # http://localhost:3000
```

Optional env for email capture:
```
RESEND_API_KEY=...
RESEND_AUDIENCE_ID=...
```

## Integrating with indices-web

Two options:
1. **Merge** (recommended): copy these files into `indices-web`, replace its
   `middleware.ts` with this one, and move the existing dashboard to `/studio`.
   One app, one deploy: public site plus private workbench.
2. **Separate deploy**: ship this as its own Vercel project on the apex domain
   and keep indices-web on a subdomain.

## Adding a story

1. Add an entry to `content/stories.ts` (slug, kicker, title, hook, caveat,
   one number, evidence table, sources with tiers).
2. Add a body component in `app/stories/[slug]/bodies/`.
3. Wire it in the `page.tsx` switch. The evidence page generates itself.

## The studio (`/studio`)

Private editorial workbench, gated by magic-link auth. Closes the agent loop: the
agent pitches, you judge, and your judgement feeds the next ranking.

- Tabs by pitch state: pitched, candidate, approved, watchlist, dormant, rejected, published
- Per pitch: approve, watchlist, reject, rank up/down, and a free-text note that
  travels into the next run's prompt as editorial direction
- Detail view shows mechanism, caveat, chart hint, resurface condition and the raw
  trigger rows (the exact observations that fired the detector)
- **Rejecting never deletes.** If a pitch has no resurface condition, rejecting sets
  an automatic 90-day re-look, so a weak-today idea comes back when data has moved
- Inbox form: add ideas, links, articles or datasets. Paste an RSS URL and the
  watcher auto-registers it on the next run
- Panels for recent agent runs and your last decisions

Every action writes to `pitch_feedback`, which the daily runner reads back into the
taste-layer prompt. That is the mechanism by which the ranking converges on you.

## Index pages (`/indices`)

`/indices/hsi` is the first published Caveat index and the site's citable artefact.
It implements section 11 of the Composite Index Construction Standard in full:

- Ranked scores for all 30 scored countries, with coverage against each
- The 8 countries reported as **insufficient coverage** — the no-imputation rule
  made visible rather than hidden by quietly dropping them
- Components with their fixed bounds and weights, plus a worked example for Australia
  (raw → normalised → weighted → score)
- The sensitivity battery, published including the fact that **this vintage does not
  fully pass it**: rank correlation 0.987 is strong, max score change 3.17 is marginal
  against our own 3.00 threshold. Flagged, not quietly loosened
- Source table with tier badges and links
- JSON and CSV downloads, and a formatted citation string
- Vintage and revision policy

### Regenerating a vintage

```bash
cd ../engine && npm run publish:index
cp dist/published/hsi-*.json ../web/content/indices/
cp dist/published/hsi-*.{json,csv} ../web/public/data/
```

Published vintages are immutable: add a new one, never edit one in place.

## Access model (IAM)

Three roles, enforced by Supabase RLS via an `is_admin()` helper:

| Role | Sees |
|---|---|
| public (anon) | Stories, evidence pages, indices, methodology, and the curated news ticker |
| subscriber | The above, plus `/account`: alert preferences and followed topics |
| admin | Everything, plus `/studio` and `/studio/ask` |

Registration is the same magic link as sign-in: a first-time address creates an
`auth.users` row, a trigger creates a `profiles` row with role `subscriber`, and
they land on `/account`.

**Bootstrap yourself as admin after running `09_iam.sql`:**
```sql
update profiles set role = 'admin' where email = 'you@example.com';
```
Until you do, nobody can reach the studio — including you.

**Supabase Auth URL config** (Authentication → URL configuration):
- Site URL: `https://the-indices.vercel.app`
- Redirect URLs must include:
  - `https://the-indices.vercel.app/auth/callback`
  - `https://the-indices.vercel.app/auth/confirm`
  - `http://localhost:3000/auth/callback` and `/auth/confirm` for local

**Magic Link email template** (Authentication → Email Templates → Magic Link).
Replace the body with this so sign-in works across browsers (no PKCE cookie):

```html
<h2>Sign in to Caveat</h2>
<p>Your one-time code:</p>
<p style="font-size:1.4rem;letter-spacing:.2em"><strong>{{ .Token }}</strong></p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink">Sign in with this link</a></p>
<p>The code and link expire shortly. If you did not request this, ignore the email.</p>
```

`/login` accepts the 6-digit code; `/auth/confirm` completes the token-hash link.

The masthead is role-aware: signed out shows *Sign in*, subscribers see *Account*,
admins see *Studio* in editor's red.

## The ticker

Curated headlines scroll under the masthead on the home page. Only rows with
`curated = true` are exposed publicly (the sole public policy on `rss_items`),
so nothing reaches the ticker without you ticking it in the studio's News panel.
The home page revalidates every 15 minutes; the ticker pauses on hover and
disables its animation under `prefers-reduced-motion`.

## Index dashboard

A compact panel on the home page showing each published index, Australia's score
and rank, and the current vintage. It reads the published JSON in
`content/indices/`, so it needs no database and new indices appear automatically
once their vintage is committed.

## Not yet built
- Remotion render pipeline for MP4 story videos
- OG image generation per story
