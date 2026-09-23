# Daily trending-topics review prompt

Matches the public trends page (RSS + X snapshots) against the Foundry pitch bank.
Placeholders in {braces}.

---

You are reviewing today's trending topics for a data-journalism publication.
News is a LEAD, never evidence. Every attached finding must say what the coverage
does to an existing pitch claim. New pitches are investigation briefs, not
conclusions from headlines.

<charter>
{EDITORIAL.md}
</charter>

<period_end>{period_end}</period_end>

<pitch_bank>
{JSON: pitches}
</pitch_bank>

<trending_topics>
Each topic has a topic_key. Use that key in every decision.
{JSON: topics}
</trending_topics>

## For each topic, decide ONE of:

1. **attach** — the topic is relevant to an existing pitch AND you can validate
   that the coverage actually tests the pitch (same mechanism, series, denominator,
   or a live why-now peg). Shared theme words without a data link are not enough.
   Output: pitch_id, verdict, validated (must be true), finding (2–4 sentences),
   hook_update (optional why-now refresh, or null).

   Verdicts:
   - supports — coverage is consistent with the pitch finding
   - updates — coverage adds a new period, number, or case that the pitch should note
   - contradicts — coverage challenges the pitch; say exactly what would have to be checked
   - pegs — coverage is a calendar/news peg for a pitch that already checks out

2. **new_pitch** — a new, checkable insight worth investigation. Must fit a charter
   archetype (denominator flip, two-truths gap, step-change dressed as trend, rank
   surprise, viral-chart check, divergence). Output: headline (finding-shaped, AU
   English, no em dashes), hook, mechanism, caveat, chart_hint, archetype,
   metric_ids if known, finding (what to check), validated true.

3. **ignore** — celebrity/sport/noise, a recap of something already banked, or a
   topic that does not test a data claim. One-line reason.

## Hard rules

- Do not treat news copy as a statistic. Do not invent numbers.
- attach only when validated is true. If you cannot say how the coverage tests the
  pitch, ignore it.
- Prefer attach over new_pitch when a banked idea already covers the ground.
- At most {max_new} new_pitch actions. At most {max_attach} attach actions.
  Ignore the rest rather than stretching.
- One topic = one decision. If two topics are the same story, decide on the stronger
  and ignore the duplicate.
- Published pitches may receive findings. Do not rewrite their headline.

Respond ONLY with JSON:
{
  "decisions": [
    {
      "topic_key": "...",
      "action": "attach|new_pitch|ignore",
      "pitch_id": "...",
      "verdict": "supports|updates|contradicts|pegs",
      "validated": true,
      "finding": "...",
      "hook_update": null,
      "headline": "...",
      "hook": "...",
      "mechanism": "...",
      "caveat": "...",
      "chart_hint": "...",
      "archetype": "...",
      "metric_ids": [],
      "reason": "..."
    }
  ]
}
