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

## Not yet built

- `/studio`: pitch review UI wired to `pitch_feedback` (closes the agent loop)
- Index pages (HSI scores, components, sensitivity, CSV/JSON downloads)
- Remotion render pipeline for MP4 story videos
- OG image generation per story
