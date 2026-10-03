# News Story Structure Brief

**Purpose:** Instructions for generating business and data news stories in the house style of *The Wall Street Journal* and *The Australian Financial Review*.
**Applies to:** Every story the app produces. Treat the rules marked **MUST** as hard requirements.

> House decisions (Oct 2026), applied on top of this brief:
> - **Quotes:** a direct quote runs only if it is verified word for word against its source page. If no verifiable quote exists, the story publishes without one (the quote rule in §2.6 and §6 is waived in that case only). A quote is never paraphrased into quotation marks or invented.
> - **Numbers:** every figure must also trace to Caveat's stored data (see EDITORIAL.md); figures found only on the web are named without the number.

---

## 1. Core Principles

1. **Lead with the news.** The most important fact goes first. Never warm up.
2. **Every claim is specific.** Use numbers over adjectives, names over "a company," and dates over "recently."
3. **Every fact is sourced.** If a fact can't be sourced, it doesn't run (see §5).
4. **Every story is visual.** Words carry the narrative; graphics and animations carry the data (see §4).
5. **Write for an intelligent non-specialist.** Explain jargon once, in plain English, on first use.
6. **Neutral tone.** Opinion appears only in clearly labelled analysis or column formats.

---

## 2. Story Structure (in order)

### 2.1 Headline (MUST)
- 6–12 words, active voice, present tense, with a strong verb.
- Make a claim, not a topic. ✅ "Retailer Cuts Forecast as Shoppers Pull Back" ❌ "Retail Sector Update"
- Include a number or a named actor where possible.

### 2.2 Deck / Standfirst (MUST)
- 1–2 sentences, 20–35 words, directly under the headline.
- Adds the "so what" or the second-most-important fact.
- **Test:** headline and deck together must tell the whole story to someone who reads nothing else.

### 2.3 Hero Graphic (MUST)
- Placed directly below the deck, before or alongside the lede.
- Must show the single most important number or trend in the story (see §4).

### 2.4 Lede: first paragraph (MUST)
Choose one style:

| Style | When to use | Format |
|---|---|---|
| **Hard-news lede** | Breaking news, results, deals, announcements | Who, what, when and the key number in 25–35 words |
| **Anecdotal lede** | Features, trends, explainers | A concrete person, place or moment that represents the larger story. 1–3 short paragraphs maximum before the nut graf |

### 2.5 Nut Graf: paragraph 2–4 (MUST)
- The most important structural element.
- States **why this matters now**, the **bigger trend**, and **why the reader should care**.
- In an anecdotal lede, this is the bridge from the specific example to the big picture.
- If the nut graf can't be written in two sentences, the story's angle isn't clear yet. Fix the angle first.

### 2.6 Supporting Evidence (MUST)
- Proves the nut graf, using:
  - **Hard data:** figures, filings, market moves, survey results. Visualise them (§4).
  - **Direct quotes:** at least one strong quote from a named principal by paragraph 4–6.
  - **Attributed reporting:** documents, announcements, analysts, and "people familiar with the matter" where a source cannot be named.
- Order the evidence from strongest to weakest.

### 2.7 Context and Background
- How we got here: history, prior events, competitors, regulation.
- Keep it tight. Place it **after** the reader is hooked, never before.
- Use a timeline graphic when there are 3 or more dated events (§4).

### 2.8 "To Be Sure" Paragraph (MUST)
- The counterargument, risk, limitation or sceptic's view.
- Name who holds the opposing view and why.
- This builds credibility. A story without it reads as advocacy.

### 2.9 What's Next
- Upcoming decisions, deadlines, reporting dates, regulatory steps or market expectations.
- Business readers want the forward view.

### 2.10 Kicker
- **Features:** a closing line that calls back to the opening anecdote, or a pointed final quote.
- **Hard news:** may end on the last useful fact. Never end on a summary or a cliché.

### 2.11 Sources and Footnotes (MUST)
- See §5.

---

## 3. Writing Style Rules

- **Paragraphs:** 1–3 sentences. One idea per paragraph.
- **Sentences:** average under 25 words. Vary the length for rhythm.
- **Voice:** active. "The board approved the deal," not "The deal was approved."
- **Verbs:** precise and strong (*slashed, surged, stalled, won*), not *saw, had, was*.
- **Numbers:** spell out one to nine and use numerals for 10 and above. Always give a comparison for scale (vs last year, vs competitors, vs forecast).
- **Currency:** state the currency on first mention (A$, US$).
- **Attribution:** "said" is the default verb. Avoid "claimed," "admitted" and similar loaded verbs.
- **No hype words:** *revolutionary, game-changing, unprecedented* (unless literally true and sourced).

---

## 4. Supporting Graphics and Animations (CRITICAL)

> **Visuals are not decoration. They are a primary storytelling layer.** Many readers will absorb the story through the graphics alone. A story with data but no visualisation is incomplete and **must not be published**.

### 4.1 Minimum Requirements (MUST)
- **One hero graphic** directly under the deck, showing the core number or trend.
- **One supporting graphic for every major data point or claim** in the evidence section.
- **A timeline** whenever the story references 3 or more dated events.
- **At least one animation or interactive element** per story where the data changes over time, compares groups, or has a "reveal" moment.

### 4.2 Choosing the Right Graphic

| Story element | Use |
|---|---|
| Change over time | Line chart, or an animated line that draws in |
| Comparison between items | Horizontal bar chart (sorted) |
| Share of a whole | Stacked bar or a single highlighted bar. Avoid pie charts beyond 3 slices |
| One headline number | Big-number stat card with a comparison ("▲ 23% vs last year") |
| Sequence of events | Timeline |
| Geography | Map (choropleth or point) |
| Process or relationship | Flow diagram |
| Before/after | Slider comparison or side-by-side |

### 4.3 Animation Guidelines
- **Animate to explain, not to entertain.** Every animation must reveal something: a trend building, a ranking changing, a gap widening.
- **Good uses:** line charts drawing in over time, bars racing or re-sorting, counters ticking up to a headline figure, scroll-triggered step-by-step reveals, map layers appearing in sequence.
- **Duration:** 0.6–1.5 seconds per transition. The full sequence must be under 5 seconds unless it is scroll-driven.
- **Trigger:** on scroll into view, never on page load for below-the-fold graphics.
- **Accessibility:** respect `prefers-reduced-motion`. Show the final static state instead.
- **Final frame:** the end state of every animation must work as a complete static chart.

### 4.4 Graphic Anatomy (MUST for every graphic)
Each graphic must include:
1. **Headline:** states the takeaway, not the topic. ✅ "Sales fell for a third straight quarter" ❌ "Quarterly sales"
2. **Subhead:** units, timeframe, and what is being measured.
3. **Labelled axes and units.**
4. **Direct labels** on lines and bars wherever possible, instead of a separate legend.
5. **Highlight colour** on the key data point. Everything else is muted grey.
6. **Source line** at the bottom: "Source: [Organisation], [Dataset/Report], [Date]". Link to the matching footnote.
7. **Alt text** describing the takeaway for screen readers.

### 4.5 Placement
- Place each graphic **immediately after** the paragraph it supports.
- Never stack more than two graphics without text between them.
- Text and graphic must agree. If the text says "fell 12%," the chart must show 12%.

---

## 5. Sourcing and Footnotes (CRITICAL)

> **Every factual claim, figure, quote and graphic must be traceable to a source listed in the footnotes.** No exceptions.

### 5.1 Rules (MUST)
- **Inline markers:** use numbered footnote markers in the body text, e.g. `revenue rose 18%[^1]`.
- **Every number** gets a footnote.
- **Every quote** gets a footnote identifying where and when it was said (interview, press release, earnings call, filing).
- **Every graphic** carries its own source line **and** links to a footnote.
- **Anonymous sources:** describe them as specifically as possible ("a person familiar with the board's deliberations") and footnote the basis ("Interview, [date]; source requested anonymity because the talks are private").
- **Prefer primary sources:** company filings, regulator data, official statistics and original reports. Use secondary sources (other media) only when primary sources are unavailable, and say so.
- **Conflicting sources:** note the discrepancy in the text and footnote both.

### 5.2 Footnote Format
Place a **Sources** section at the end of every story:

```markdown
---

## Sources

[^1]: Company Name, *Annual Report 2026*, p. 14, published 28 August 2026. https://...
[^2]: Australian Bureau of Statistics, *Retail Trade, Australia*, August 2026 release. https://...
[^3]: Interview with Jane Smith, CEO, Company Name, 1 October 2026.
[^4]: Analyst note, Firm Name, "Note Title", 30 September 2026.
[^5]: Graphic data: Source Organisation, Dataset Name, accessed 2 October 2026. https://...
```

Each footnote must include, where applicable: **author/organisation, title, publication or dataset, date, page or section, and URL**.

### 5.3 Inflation figures (MUST)
- When a story reports CPI inflation, give **headline CPI and the trimmed mean together**, each footnoted, with the same reference period (monthly with monthly, quarterly with quarterly).
- Add the guard in one sentence: **the trimmed mean is the RBA's preferred measure of underlying inflation**, so it, more than the headline, moves rate decisions. (The formal target is headline CPI of 2–3%; do not write that the RBA "targets" the trimmed mean.)
- Component figures (electricity, rents, insurance) come from the stored CPI breakdown, never from memory.

---

## 6. Pre-Publish Checklist

The app must confirm every item before output:

- [ ] Headline makes a specific claim with an active verb
- [ ] Headline + deck tell the full story on their own
- [ ] Hero graphic sits directly under the deck
- [ ] Lede delivers the news (or a concrete anecdote) within 35 words
- [ ] Nut graf appears by paragraph 4 and explains why it matters now
- [ ] At least one named, direct quote by paragraph 6
- [ ] Every major data point has a graphic
- [ ] At least one purposeful animation or interactive element
- [ ] Timeline included if 3+ dated events
- [ ] Every graphic has a takeaway headline, labels, highlight, source line and alt text
- [ ] "To be sure" paragraph present
- [ ] "What's next" forward view present
- [ ] Every fact, number and quote has a footnote marker
- [ ] Sources section complete, with primary sources preferred
- [ ] Inflation: headline CPI and trimmed mean together, with the RBA guard
- [ ] No hype words; paragraphs of 3 sentences or fewer

---

## 7. Story Skeleton (Template)

```markdown
# [Headline: claim + verb + number/actor]

**[Deck: the so-what in 1–2 sentences]**

[HERO GRAPHIC: big-number card or key trend chart, animated]
*Source: [Org], [Dataset], [Date][^n]*

[LEDE: hard news or anecdote]

[NUT GRAF: why this matters now and the bigger trend]

[EVIDENCE PARAGRAPH: strongest data point[^n]]

[SUPPORTING GRAPHIC]

"[Named quote]," said [Name], [Title] of [Org].[^n]

[EVIDENCE: further data, attributed reporting[^n]]

[CONTEXT: how we got here]

[TIMELINE GRAPHIC if 3+ dated events]

[TO BE SURE: counterargument, risk, sceptic's view[^n]]

[WHAT'S NEXT: dates, decisions, expectations[^n]]

[KICKER]

---

## Sources

[^1]: ...
[^2]: ...
```
