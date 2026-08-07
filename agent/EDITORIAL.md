# EDITORIAL.md — the taste layer

This file encodes the editorial judgement of the publication. The taste layer reads it
before ranking any candidate. It is a living document: update it when your instincts
and the agent's picks diverge. The agent serves this file, not the other way round.

## What the publication is

Data journalism where every figure resolves to a named, tiered source. The product is
credibility: newsworthy claims a reader can check in one click. Never publish a claim
that rests on a tier-3 source. Never let a chart travel without its evidence link.

## The kinds of insight we hunt (ranked)

1. **Denominator flips.** The ranking reverses when you change the base.
   Archetype: the viral immigration chart — Poland +129% growth, but mid-pack per
   capita; Australia 7th by absolute intake, 14th per head. If per-capita, per-income
   or per-hour tells the opposite story to the raw number, that is our lead candidate.

2. **Two-truths gaps.** Two related measures of the same thing disagree sharply.
   Archetypes: top marginal tax rate (45%) vs what the average worker actually pays
   (23%); government debt (healthy) vs household debt (3rd worst on earth); high
   productivity LEVEL vs weak productivity GROWTH. The story is the gap itself.

3. **Step-changes dressed as trends.** The "rise" is actually one jump.
   Archetype: Australia's migration "uptick" was a single +39.7% step in 2023, flat
   either side. Finding the step reframes the cause and kills the lazy narrative.

4. **Rank surprises.** A country sits somewhere the reader will not expect —
   especially Australia. Archetype: Australians keep 70.8c of every labour-cost
   dollar vs OECD 65.2c (nobody believes tax here is comparatively light).

5. **The viral chart is misleading.** A widely shared figure collapses under a
   denominator, basis or timeframe check. Myth-correction with receipts is our
   highest-engagement, highest-credibility format. Requires naming exactly what the
   original measured and why that framing misleads — never strawman it.

6. **Divergence of the previously married.** Two series that tracked for years
   split. Wages vs productivity. Yields vs inflation. The split date is the hook.

## The Australia lens

Australia is the home market and default protagonist. The standing narrative arc the
data has consistently supported: strong state and payslip (light tax wedge, high
wages, low public debt) sitting on a stretched household (world-extreme housing debt,
soft real wage growth, thin savings). Candidates that advance, complicate or
credibly CHALLENGE this arc rank above candidates unrelated to it. A finding that
contradicts our own prior story is a feature, not a threat — correcting ourselves
publicly is a credibility asset.

## Hard filters (kill on sight)

- Any claim whose trigger rows include `status = 'estimated'` values above 25% of
  the calculation's weight.
- Correlation offered as insight without a mechanism a lay reader would accept.
  With ~20 metrics x 38 countries, spurious pairs are guaranteed. A correlation
  candidate must name the plausible causal channel or die.
- Mixed-basis arithmetic presented as precise (PPP income vs market-USD prices) —
  allowed only as "directional", and say so.
- Anything that requires more than two sentences to explain why it matters.
- Tier-3-sourced headline claims. Tier 3 may colour, never carry.
- Re-pitching something we published unless the data has materially moved.

## Voice and headline rules

- Headlines state the finding, not the topic. "It takes 8 Australians' share of the
  stock market to buy one house" — not "Comparing housing and equity markets".
- Numbers in headlines are rounded to what survives scrutiny (one significant
  comparison per headline).
- Australian English. No em dashes. No hype adjectives; the number does the work.
- Every pitch carries: the one-line hook, the mechanism sentence, the chart type
  that best shows it, and the caveat that a hostile reader would raise first.

## Freshness and timing

- A release landing today beats a bigger insight from last month.
- "First to notice the new vintage" is a legitimate angle on its own.
- Anniversary and calendar pegs (budget week, RBA decisions, tax time) raise the
  rank of otherwise-dormant candidates. Note the peg in the pitch.

## The scoring rubric (taste layer applies 0-5 each)

- Surprise: would an informed reader's eyebrows move?
- Checkability: can a sceptic verify in under a minute from the linked rows?
- Mechanism: is there a causal story a lay reader accepts?
- Visual: does it chart cleanly in one image or one animated sequence?
- Timing: is there a reason THIS lands better today than next month?

Rank = weighted sum (Surprise x2, Checkability x2, Mechanism, Visual, Timing).
Anything scoring 0 on Checkability is killed regardless of total.

## Story structure (for approved pitches graduating to briefs)

A publishable story is built in layers, not delivered as a single reveal:
1. Open with the familiar frame (what the reader thinks they know).
2. Add data one layer at a time, each layer shifting the picture — the sequence IS
   the story. Animated timelines should reveal in this order, not all at once.
3. Where relevant, place precursors on the timeline: the geopolitical, political or
   economic events that preceded the inflection (border reopening before the 2023
   migration step; rate decisions before yield moves; policy changes before
   household-debt shifts). Precursors are annotations with dates and sources, held
   to the same provenance standard as the data.
4. Close on the corrected frame and the one number that carries it.
