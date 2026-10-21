import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { cellRef, colName, excelDate, label, readWorkbook, sheetRows, xmlText } from './xlsx.mjs';

// ---------- an .xlsx is a zip of XML parts: build a tiny one (stored and deflated entries) and read it back
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

const workbook = `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>
<sheet name="Contents" sheetId="1" r:id="rId1"/><sheet name="Data &amp; Notes" sheetId="2" r:id="rId2"/></sheets></workbook>`;
const rels = `<Relationships><Relationship Id="rId2" Type="ws" Target="worksheets/sheet2.xml"/><Relationship Id="rId1" Type="ws" Target="/xl/worksheets/sheet1.xml"/><Relationship Id="rId9" Type="ss" Target="sharedStrings.xml"/></Relationships>`;
const shared = `<sst><si><t>Fuel type</t></si><si><r><t>Total </t></r><r><rPr><b/></rPr><t>renewable</t></r></si><si><t xml:space="preserve"> 2025 (est.) </t><rPh><t>x</t></rPh></si></sst>`;
const sheet1 = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Figures &amp; Tables</t></is></c></row></sheetData></worksheet>`;
const sheet2 = `<worksheet><sheetData>
<row r="2"><c r="A2" t="s"><v>0</v></c><c r="C2" t="s"><v>2</v></c></row>
<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3"><v>1.5</v></c><c r="C3"><f>B3*2</f><v>3</v></c><c r="D3" t="e"><v>#N/A</v></c><c r="E3" t="b"><v>1</v></c><c r="F3" t="str"><f>"a"&amp;"b"</f><v>ab</v></c></row>
<row r="4"/>
<row r="5"><c r="AB5"><v>-0.25</v></c></row>
</sheetData></worksheet>`;
const buf = zip([
  ['[Content_Types].xml', '<Types/>', false], ['xl/workbook.xml', workbook, true], ['xl/_rels/workbook.xml.rels', rels, false],
  ['xl/sharedStrings.xml', shared, true], ['xl/worksheets/sheet1.xml', sheet1, true], ['xl/worksheets/sheet2.xml', sheet2, false],
]);
const wb = readWorkbook(buf);
assert.deepEqual(wb.names, ['Contents', 'Data & Notes']);
assert.deepEqual(wb.sheet('Contents'), [['Figures & Tables']]);
const rows = wb.sheet('Data & Notes');
assert.deepEqual(rows[0], [], 'a row the sheet does not have is empty');
assert.deepEqual(rows[1], ['Fuel type', null, ' 2025 (est.) '], 'shared strings; phonetic runs left out; a gap is null');
assert.deepEqual(rows[2], ['Total renewable', 1.5, 3, null, true, 'ab'], 'rich text joined; a formula gives its cached value; an error is no value');
assert.deepEqual(rows[3], []);
assert.equal(rows[4].length, 28);
assert.equal(rows[4][27], -0.25, 'AB is column 28');
assert.equal(wb.sheet('Nope'), null);
assert.throws(() => readWorkbook(zip([['word/document.xml', '<doc/>', false]])), /not an Excel workbook/);

// ---------- pieces
assert.deepEqual(cellRef('A1'), { row: 0, col: 0 });
assert.deepEqual(cellRef('AB12'), { row: 11, col: 27 });
assert.equal(cellRef('1A'), null);
assert.equal(colName(0), 'A');
assert.equal(colName(27), 'AB');
assert.equal(colName(cellRef('XFD1').col), 'XFD');
assert.equal(excelDate(38231), '2004-09-01', 'the September quarter 2004 in the emissions workbook');
assert.equal(excelDate(46082), '2026-03-01');
assert.equal(excelDate(NaN), null);
assert.equal(xmlText('a &amp; b _x000D_ &#8211; &#x2014;'), 'a & b \r – —');
assert.equal(label('  Hydro  [note a] '), 'Hydro [note a]');
assert.equal(label(null), '');
assert.deepEqual(sheetRows('<sheetData><row><c><v>1</v></c><c><v>2</v></c></row><row><c t="s"><v>0</v></c></row></sheetData>', ['x']), [[1, 2], ['x']], 'rows and cells without references run in order');

console.log('xlsx checks passed');
