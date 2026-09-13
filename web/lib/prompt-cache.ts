/**
 * Cache breakpoints for the Anthropic Messages API.
 *
 * Both agent loops re-send the whole request on every pass, so a page pulled in by fetch_url on
 * pass two is billed again in full on passes three through eight. A cached prefix read costs a
 * tenth of a fresh read, which is what makes those repeats cheap.
 *
 * The cached prefix runs from the start of the request (tools, then system, then messages) up to
 * and including the block carrying the breakpoint, and a request may carry at most four. One is
 * spent closing the static tools-and-system prefix; two roll along the transcript.
 */

const EPHEMERAL = { type: 'ephemeral' } as const;

export type CacheableMessage = { role: string; content: unknown };

/**
 * `system` as a block list with a breakpoint at the end, which closes the prefix over the tool
 * definitions as well since tools are serialised ahead of system.
 */
export function cachedSystem(system: string) {
  return [{ type: 'text', text: system, cache_control: EPHEMERAL }];
}

/** A copy of `msg` whose final content block carries a breakpoint. */
function markMessage(msg: CacheableMessage): CacheableMessage {
  // An empty text block is rejected outright, so leave blank turns unmarked.
  if (typeof msg.content === 'string') {
    if (!msg.content.trim()) return msg;
    return { ...msg, content: [{ type: 'text', text: msg.content, cache_control: EPHEMERAL }] };
  }
  if (!Array.isArray(msg.content) || !msg.content.length) return msg;
  const blocks = [...msg.content];
  const last = blocks[blocks.length - 1];
  if (!last || typeof last !== 'object') return msg;
  blocks[blocks.length - 1] = { ...(last as object), cache_control: EPHEMERAL };
  return { ...msg, content: blocks };
}

/**
 * Breakpoints on the newest message and on whichever message was newest last pass. The older one
 * is the prefix this pass reads back; the newer one extends the cache ready for the next pass.
 *
 * Returns the marked copy alongside the index to pass back as `previousIndex` next time. The
 * caller's own array stays clean so breakpoints cannot accumulate past the limit of four.
 */
export function withCachedPrefix(
  messages: CacheableMessage[],
  previousIndex: number | null,
): { messages: CacheableMessage[]; newestIndex: number } {
  const newestIndex = messages.length - 1;
  if (newestIndex < 0) return { messages, newestIndex };
  const marked = messages.map((m, i) =>
    i === newestIndex || i === previousIndex ? markMessage(m) : m,
  );
  return { messages: marked, newestIndex };
}

export type CacheUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};

/** Anthropic reports cached reads and writes separately from fresh input. */
export function readUsage(usage: unknown): CacheUsage {
  const u = (usage ?? {}) as Record<string, unknown>;
  return {
    input_tokens: Number(u.input_tokens ?? 0),
    output_tokens: Number(u.output_tokens ?? 0),
    cache_read_tokens: Number(u.cache_read_input_tokens ?? 0),
    cache_write_tokens: Number(u.cache_creation_input_tokens ?? 0),
  };
}
