import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  budgetName, cleanText, docxTables, fyCell, num, parseFiscal, parseUnderlyingCash, reconcile, statement11Url, unzipEntry,
} from './budget-history.mjs';

// ---------- a .docx is a zip: build one with a deflated and a stored entry, read them back
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text, deflate] of entries) {
    const raw = Buffer.from(text, 'utf8'), data = deflate ? deflateRawSync(raw) : raw, n = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data); centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const z = zip([['word/styles.xml', '<styles/>', false], ['word/document.xml', '<doc>hello</doc>', true]]);
assert.equal(unzipEntry(z, 'word/document.xml').toString(), '<doc>hello</doc>');
assert.equal(unzipEntry(z, 'word/styles.xml').toString(), '<styles/>');
assert.equal(unzipEntry(z, 'nope.xml'), null);
assert.throws(() => unzipEntry(Buffer.from('not a zip at all, not a zip at all'), 'x'), /not a zip/);

// ---------- cells as Word writes them: non-breaking spaces, zero-width joiners, minus signs
assert.equal(cleanText('Table 11.6: x'), 'Table 11.6: x');
assert.equal(num('-4,342'), -4342);
assert.equal(num('−4,342'), -4342);
assert.equal(num('-'), 0, 'a dash is nothing (no Future Fund earnings)');
assert.equal(num('na'), null);
assert.equal(num('Revenue'), undefined);
assert.deepEqual(fyCell('2024-25'), { fy: '2024-25', estimate: false });
assert.deepEqual(fyCell('2025‍–‍26 (e)'), { fy: '2025-26', estimate: true });
assert.equal(fyCell('2024-26'), null, 'not a financial year');
assert.equal(fyCell('1999-00')?.fy, '1999-00');

// ---------- the two tables, in Word's XML
const cell = (t) => `<w:tc><w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p></w:tc>`;
const row = (cells) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;
const para = (t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const table = (rows) => `<w:tbl>${rows.map(row).join('')}</w:tbl>`;
const head = ['', 'Revenue', '', 'Expenses', '', 'Net operating balance(b)', '', 'Net capital investment', '', 'Fiscal balance(c)'];
// Rows from Budget 2026–27 Statement 11 Table 11.6 (spacer cells left empty as in the document).
const t116 = (rows) => para('Table 11.6: Australian Government general government sector revenue, expenses, net operating balance, net capital investment and fiscal balance(a)') + table([head, ...rows]);
const xml = [
  para('Table 11.1: Australian Government general government sector receipts, payments, net Future Fund earnings and underlying cash balance(a)'),
  table([
    ['2004-05', '235,984', '25.4', '', '222,407', '1.9', '24.0', '', '-', '', '13,577', '1.5'],
    ['2007-08', '294,917', '25.0', '', '271,843', '3.9', '23.1', '', '3,319', '', '19,754', '1.7'],
    ['2020-21', '519,913', '24.9', '', '654,084', '17.1', '31.3', '', '6,619', '', '-134,171', '-6.4'],
    ['2025-26 (e)', '759,772', '25.6', '', '788,056', '4.3', '26.6', '', '7,457', '', '-28,284', '-1.0'],
  ]),
  t116([
    ['2007-08', '303,402', '25.7', '', '', '280,335', '23.7', '', '23,068', '2.0', '', '2,593', '0.2', '', '20,475', '1.7'],
    ['2008-09', '298,508', '23.6', '', '', '324,889', '25.7', '', '-26,382', '-2.1', '', '4,064', '0.3', '', '-30,445', '-2.4'],
  ]),
  // The continuation, and the estimates that follow the last outcome.
  t116([
    ['2009-10', '292,387', '22.3', '', '340,354', '26.0', '', '-47,967', '-3.7', '', '6,433', '0.5', '', '-54,400', '-4.2'],
    ['2025‍–‍26 (e)', '773,081', '26.1', '', '812,063', '27.4', '', '-38,982', '-1.3', '', '11,158', '0.4', '', '-50,139', '-1.7'],
  ]),
  // Table 11.10 must not be read as Table 11.1.
  para('Table 11.10: Australian Government accrual revenue, expenses and fiscal balance by institutional sector ($m)(a)'),
  table([['2007-08', '1', '2', '3']]),
].join('');
const tables = docxTables(xml);
assert.equal(tables.length, 4);
const f = parseFiscal(tables);
assert.deepEqual(f.rows.map((r) => [r.fy, r.fiscalBalance, r.fiscalBalancePct]), [['2007-08', 20475, 1.7], ['2008-09', -30445, -2.4], ['2009-10', -54400, -4.2]]);
assert.deepEqual(f.estimates, ['2025-26'], 'estimates are left out');
// Table 11.1 in the test skips years on purpose: a break in the years stops the parse.
assert.throws(() => parseUnderlyingCash(tables), /2004-05 is followed by 2007-08/);
const t111 = (r) => docxTables(para('Table 11.1: receipts and underlying cash balance(a)') + table([r]));
// No Future Fund earnings before 2005-06 ("-"); 2005-06 to 2019-20 the balance is after them; from 2020-21 it is not.
assert.equal(parseUnderlyingCash(t111(['2004-05', '235,984', '25.4', '', '222,407', '1.9', '24.0', '', '-', '', '13,577', '1.5'])).rows[0].underlyingCash, 13577);
assert.equal(parseUnderlyingCash(t111(['2007-08', '294,917', '25.0', '', '271,843', '3.9', '23.1', '', '3,319', '', '19,754', '1.7'])).rows[0].underlyingCash, 19754);
assert.equal(parseUnderlyingCash(t111(['2020-21', '519,913', '24.9', '', '654,084', '17.1', '31.3', '', '6,619', '', '-134,171', '-6.4'])).rows[0].underlyingCashPct, -6.4);
assert.throws(() => parseUnderlyingCash(t111(['2020-21', '519,913', '24.9', '', '654,084', '17.1', '31.3', '', '6,619', '', '-140,790', '-6.4'])), /underlying cash balance = -140790/);

// A row that does not add up stops the parse; so do a break in the years and an estimate before an outcome.
assert.throws(() => parseFiscal(docxTables(t116([['2007-08', '303,402', '25.7', '', '280,335', '23.7', '', '23,068', '2.0', '', '2,593', '0.2', '', '20,000', '1.7']]))), /fiscal balance = 20000/);
assert.throws(() => parseFiscal(docxTables(t116([
  ['2007-08', '303,402', '25.7', '', '280,335', '23.7', '', '23,068', '2.0', '', '2,593', '0.2', '', '20,475', '1.7'],
  ['2009-10', '292,387', '22.3', '', '340,354', '26.0', '', '-47,967', '-3.7', '', '6,433', '0.5', '', '-54,400', '-4.2'],
]))), /2007-08 is followed by 2009-10/);
assert.throws(() => parseFiscal(docxTables(t116([
  ['2007-08 (e)', '303,402', '25.7', '', '280,335', '23.7', '', '23,068', '2.0', '', '2,593', '0.2', '', '20,475', '1.7'],
  ['2008-09', '298,508', '23.6', '', '324,889', '25.7', '', '-26,382', '-2.1', '', '4,064', '0.3', '', '-30,445', '-2.4'],
]))), /estimate comes before the last outcome/);
assert.throws(() => parseFiscal([]), /not found/);

// ---------- the page: which Budget, and where its Statement 11 is
const html = '<html><title>Budget Paper No. 1 | Budget 2026&ndash;27</title><a href="/content/bp1/download/bp1_bs-11.docx">DOCX</a></html>';
assert.equal(budgetName(html), 'Budget 2026–27');
assert.equal(statement11Url(html, 'https://budget.gov.au/content/bp1/index.htm'), 'https://budget.gov.au/content/bp1/download/bp1_bs-11.docx');
assert.equal(statement11Url('<a href="x.pdf">', 'https://budget.gov.au/'), null);

// ---------- reconciliation with the IMF: logged, and gross only when off by more than 25% and more than $2bn
const r = reconcile(new Map([['2020-21', -136108], ['2018-19', 1350], ['2014-15', -42206], ['1999-00', 1]]), new Map([['2020-21', -136106], ['2018-19', 2566], ['2014-15', -20000]]));
assert.equal(r.lines.length, 3);
assert.deepEqual(r.gross, ['2014-15'], '2018-19 differs by 47% but only $1.2bn: a revision, not a different measure');

console.log('budget-history checks passed');
