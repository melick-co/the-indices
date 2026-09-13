/**
 * Cache breakpoints for the Anthropic Messages API.
 *
 * Both agent loops re-send the whole request on every pass, so a page pulled in by fetch_url on
 * pass two is billed again in full on passes three through eight. A cached prefix read costs a
 * tenth of a fresh read, which is what makes those repeats cheap.
 *
 * Two breakpoints per request, against a limit of four. One closes the static tools-and-system
 * prefix so it still hits on the first pass of a turn, when the transcript has changed but the
 * charter and tool definitions have not. The other sits on the newest message: a breakpoint looks
 * back up to twenty block positions for an existing entry, and a pass adds only two positions (a
 * run of tool_use blocks, then a run of tool_result blocks), so it finds the previous pass's write.
 *
 * Sonnet 4.6 will not cache a prefix below 1,024 tokens. Tool definitions and the charter come to
 * roughly 1,700, so the static breakpoint clears it; short prefixes are silently left uncached
 * rather than erroring.
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
  blocks[blocks.length - 1] = { ...last, cache_control: EPHEMERAL };
  return { ...msg, content: blocks };
}

/**
 * The message list with a breakpoint on the newest message, ready to send. The caller's own array
 * is left untouched so breakpoints cannot accumulate past the limit across passes.
 */
export function withCachedPrefix(messages: CacheableMessage[]): CacheableMessage[] {
  if (!messages.length) return messages;
  const newest = messages.length - 1;
  return messages.map((m, i) => (i === newest ? markMessage(m) : m));
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
