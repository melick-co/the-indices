import assert from 'node:assert/strict';
import {
  CLOSING_LINE, approvable, asCheckable, columnIssues, decideCheck, slugify, statusFor,
} from './rub-rules';
import type { FactCheck } from './fact-check';
import type { ClaimAudit } from './claim-audit';

const para = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ') + '.';
const good = { title: 'The jobless rate fell. That is not a hiring boom.', paragraphs: [para(80), para(80), para(80), CLOSING_LINE] };

// Column rules.
assert.deepEqual(columnIssues(good), []);
assert.ok(columnIssues({ ...good, paragraphs: good.paragraphs.slice(0, -1) }).some((i) => i.includes('must end')));
assert.ok(columnIssues({ ...good, paragraphs: [...good.paragraphs.slice(0, -1), 'Which, if we are being precise, is the rub'] }).some((i) => i.includes('must end')));
assert.ok(columnIssues({ ...good, paragraphs: [para(120), para(120), CLOSING_LINE] }).some((i) => i.includes('2 paragraphs')));
assert.ok(columnIssues({ ...good, paragraphs: [para(60), para(60), para(60), para(60), para(60), CLOSING_LINE] }).some((i) => i.includes('5 paragraphs')));
assert.ok(columnIssues({ ...good, paragraphs: [para(40), para(40), para(40), CLOSING_LINE] }).some((i) => /120 words/.test(i)));
assert.ok(columnIssues({ ...good, paragraphs: [para(120), para(120), para(120), CLOSING_LINE] }).some((i) => /360 words/.test(i)));
assert.ok(columnIssues({ ...good, title: 'Rates — again' }).some((i) => i.includes('em dash')));
assert.ok(columnIssues({ ...good, paragraphs: [`${para(80)} — so.`, para(80), para(80), CLOSING_LINE] }).some((i) => i.includes('em dash')));
assert.ok(columnIssues({ ...good, title: '' }).some((i) => i.includes('no title')));

// The column in the story checks' shape: body paragraphs only, no closing line, no chart.
const story = asCheckable(good);
assert.equal(story.body.blocks.length, 3);
assert.equal(story.hook, '');

// The decision fails closed.
const factOk: FactCheck = { ok: false, issues: ['no chart'], unsupported: [], warnings: [] };
const auditOk: ClaimAudit = { ok: true, claims: [{ claim: '4.1 per cent', verdict: 'supported', evidence: 'x' }], unsupported: [] };
const pass = decideCheck({ columnIssues: [], fact: factOk, audit: auditOk, apiKey: true });
assert.equal(pass.ok, true, 'a column needs no chart');
assert.equal(pass.audited, true);
assert.equal(statusFor(pass), 'pending');
assert.equal(approvable(pass), true);

const noKey = decideCheck({ columnIssues: [], fact: factOk, audit: null, apiKey: false });
assert.equal(noKey.ok, false, 'audit not run is not a pass');
assert.equal(noKey.audited, false);
assert.equal(statusFor(noKey), 'draft');
assert.ok(noKey.issues.some((i) => i.includes('ANTHROPIC_API_KEY')));

const auditThrew = decideCheck({ columnIssues: [], fact: factOk, audit: null, auditError: 'anthropic 401', apiKey: true });
assert.equal(auditThrew.ok, false);
assert.ok(auditThrew.issues.some((i) => i.includes('401')));

const noFact = decideCheck({ columnIssues: [], fact: null, factError: 'db down', audit: auditOk, apiKey: true });
assert.equal(noFact.ok, false, 'figure check not run is not a pass');

const badFigure: FactCheck = { ok: false, issues: ['paragraph 1: 9.9 is not in the stored data', 'no chart'], unsupported: [{ where: 'paragraph 1', value: 9.9 }] };
const figs = decideCheck({ columnIssues: [], fact: badFigure, audit: null, apiKey: true });
assert.equal(figs.ok, false);
assert.deepEqual(figs.issues.filter((i) => i.includes('9.9')).length, 1);
assert.ok(!figs.issues.includes('no chart'));

const unlinked: FactCheck = { ok: false, issues: ['story is not linked to any stored metric', 'no chart'], unsupported: [] };
assert.equal(decideCheck({ columnIssues: [], fact: unlinked, audit: auditOk, apiKey: true }).ok, false);

const unsupported: ClaimAudit = { ok: false, claims: [], unsupported: [{ claim: 'lowest since 1974', verdict: 'unsupported', evidence: 'history too short' }] };
const claims = decideCheck({ columnIssues: [], fact: factOk, audit: unsupported, apiKey: true });
assert.equal(claims.ok, false);
assert.equal(claims.audited, true);
assert.ok(claims.issues[0].includes('lowest since 1974'));

const style = decideCheck({ columnIssues: ['column: em dash (house style: none)'], fact: factOk, audit: auditOk, apiKey: true });
assert.equal(style.ok, false, 'column rules block');
assert.equal(statusFor(style), 'draft');

assert.equal(approvable({ ok: true, audited: false }), false);
assert.equal(approvable({ legacy: true }), false);
assert.equal(approvable(null), false);

assert.equal(slugify("The jobless rate fell. That's not a boom!"), 'the-jobless-rate-fell-thats-not-a-boom');

console.log('rub-rules.check: ok');
