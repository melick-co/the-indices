import assert from 'node:assert/strict';
import {
  slugTopic,
  topicFingerprint,
  findingKey,
  topicKeyOf,
  findingsOf,
  alreadyHasFinding,
  appendFinding,
  collectTopics,
  applyDecisions,
} from './trending-review.mjs';

assert.equal(slugTopic('RBA holds the cash rate'), 'rba-holds-the-cash-rate');
assert.equal(topicFingerprint('RBA holds the cash rate'), 'trending:rba-holds-the-cash-rate');
assert.equal(
  findingKey('2026-09-22', 'rss', 'au', 'RBA holds the cash rate'),
  '2026-09-22|rss|au|rba-holds-the-cash-rate',
);
assert.equal(
  topicKeyOf('rss', 'au', '1d', 'RBA holds the cash rate'),
  'rss:au:1d:rba-holds-the-cash-rate',
);

const empty = { trigger_rows: { fingerprint: 'x' } };
assert.deepEqual(findingsOf(empty), []);
assert.equal(alreadyHasFinding(empty, 'k'), false);

const finding = { key: '2026-09-22|rss|au|rba-holds-the-cash-rate', topic: 'RBA holds the cash rate' };
const next = appendFinding(empty.trigger_rows, finding);
assert.equal(next.findings.length, 1);
assert.equal(appendFinding(next, finding).findings.length, 1);
assert.equal(alreadyHasFinding({ trigger_rows: next }, finding.key), true);

const topics = collectTopics([
  {
    source: 'rss', region: 'au', window_type: '1d', period_end: '2026-09-22',
    topics: [
      { topic: 'RBA holds the cash rate', score: 10 },
      { topic: 'Housing credit growth', score: 9 },
      { topic: 'RBA holds the cash rate', score: 8 },
    ],
  },
  {
    source: 'x', region: 'au', window_type: '1d', period_end: '2026-09-22',
    topics: [
      { topic: 'RBA holds the cash rate', tweet_volume: 12000 },
      { topic: 'Ashes series', tweet_volume: 9000 },
    ],
  },
  {
    source: 'rss', region: 'au', window_type: '7d', period_end: '2026-09-22',
    topics: [{ topic: 'Should be ignored', score: 10 }],
  },
]);

assert.equal(topics.length, 3);
assert.equal(topics[0].topic, 'RBA holds the cash rate');
assert.equal(topics[1].topic, 'Housing credit growth');
assert.equal(topics[2].topic, 'Ashes series');
assert.equal(topics[2].source, 'x');

function mockDb({ fingerprintTaken = false } = {}) {
  const updates = [];
  const events = [];
  const inserts = [];
  return {
    updates,
    events,
    inserts,
    from(table) {
      const api = {
        update(patch) {
          updates.push({ table, patch });
          return { eq: async () => ({ error: null }) };
        },
        insert(row) {
          if (table === 'pitch_events') {
            events.push(row);
            return Promise.resolve({ error: null });
          }
          inserts.push(row);
          return {
            select() {
              return {
                async single() {
                  return { data: { id: 'new-1', headline: row.headline }, error: null };
                },
              };
            },
          };
        },
        select() {
          return {
            count: undefined,
            contains() {
              return Promise.resolve({ count: fingerprintTaken ? 1 : 0, error: null });
            },
          };
        },
      };
      return api;
    },
  };
}

const topic = topics[0];
const pitch = {
  id: 'p1',
  headline: 'The cash rate is the peg, not the finding',
  hook: 'old hook',
  state: 'pitched',
  trigger_rows: { fingerprint: 'existing' },
};

{
  const db = mockDb();
  const result = await applyDecisions(db, {
    topics,
    pitches: [pitch],
    decisions: [{
      topic_key: topic.topic_key,
      action: 'attach',
      pitch_id: 'p1',
      verdict: 'pegs',
      validated: true,
      finding: 'The hold is a why-now peg for the existing rate brief.',
      hook_update: 'RBA held overnight. The pitch is the household debt gap, not the hold.',
    }],
  });
  assert.equal(result.attached, 1);
  assert.equal(db.updates[0].patch.hook.startsWith('RBA held'), true);
  assert.equal(db.events[0].event, 'trending_finding');
  assert.equal(db.updates[0].patch.trigger_rows.findings[0].verdict, 'pegs');
}

{
  const db = mockDb();
  const result = await applyDecisions(db, {
    topics,
    pitches: [pitch],
    decisions: [{
      topic_key: topics[1].topic_key,
      action: 'new_pitch',
      validated: true,
      headline: 'Household credit is still the heavier stock',
      hook: 'Housing credit is trending because the print moved.',
      mechanism: 'Credit stock vs AGS stock.',
      caveat: 'RBA D2 revisions.',
      finding: 'Check D2 against the AOFM stock.',
    }],
  });
  assert.equal(result.created, 1);
  assert.equal(db.inserts[0].detector, 'trending_topic');
  assert.equal(db.inserts[0].state, 'candidate');
  assert.equal(db.inserts[0].trigger_rows.fingerprint, 'trending:housing-credit-growth');
}

{
  const db = mockDb();
  const result = await applyDecisions(db, {
    topics,
    pitches: [pitch],
    decisions: [{
      topic_key: topic.topic_key,
      action: 'attach',
      pitch_id: 'p1',
      verdict: 'pegs',
      validated: false,
      finding: 'Should not attach.',
    }],
  });
  assert.equal(result.attached, 0);
  assert.equal(result.skipped, 1);
}

console.log('trending-review.check: ok');
