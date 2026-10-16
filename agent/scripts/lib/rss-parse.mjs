/**
 * Minimal RSS/Atom parser shared by the RSS watcher (run-rss.mjs) and the Australia Inc. pipeline
 * (web/lib/australia-inc-pipeline.ts): tolerant, no dependencies. Both store items in rss_items keyed by
 * sha256 of the guid, so they must parse the guid the same way, or one feed's items would be stored twice.
 */
import { createHash } from 'node:crypto';

export const sha = (s) => createHash('sha256').update(s).digest('hex');

export function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<(item|entry)[\s\S]*?<\/\1>/gi) ?? [];
  for (const b of blocks) {
    const pick = (tags) => {
      for (const t of tags) {
        const m = b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i'));
        if (m) return m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ').trim();
      }
      return null;
    };
    const linkAttr = b.match(/<link[^>]*href="([^"]+)"/i)?.[1];
    items.push({
      title: pick(['title']) ?? '(untitled)',
      link: pick(['link']) || linkAttr || null,
      summary: (pick(['description','summary','content:encoded','content']) ?? '').slice(0, 600),
      guid: pick(['guid','id']) || linkAttr || pick(['link']) || pick(['title']),
      published: pick(['pubDate','published','updated','dc:date']),
    });
  }
  return items;
}
