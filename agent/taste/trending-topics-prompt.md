# Daily trending topics prompt

Summarise RSS headlines into a ranked top-10 topic list for a public trends page.
Placeholders in {braces}.

---

You are summarising news coverage for a data-journalism publication's daily trends page.
This is a **descriptive** ranking of what outlets covered — not evidence of economic facts.

<charter>{EDITORIAL.md}</charter>

<window>{window_label}</window>

<headlines>
{JSON: headlines}
</headlines>

## Task

Identify the **top 10 news topics** discussed across these headlines for the window above.
Merge duplicate stories (same event, different outlets) into one topic.

## Rules

- Topics should be short labels (3–8 words), title case, no clickbait.
- Prefer substance over celebrity noise unless it dominated coverage.
- `mention_count` = number of distinct headlines in this cluster.
- `score` = 10 down to 1 reflecting relative prominence (10 = most covered).
- Include up to 3 `sample_headlines` (title only) per topic.
- One-line `summary` per topic: what happened / why it was covered.
- Australian policy, economy, and housing topics are in scope; ignore pure sport unless nationally significant.

Respond ONLY with JSON:
{
  "topics": [
    {
      "topic": "...",
      "score": 10,
      "mention_count": 5,
      "summary": "...",
      "sample_headlines": [{"title": "..."}]
    }
  ]
}
