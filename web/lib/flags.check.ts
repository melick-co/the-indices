import assert from 'node:assert/strict';
import { flagCode } from './flags';

for (const [name, code] of [
  ['England', 'GB_ENG'], ['India', 'IN'], ['China (excludes SARs and Taiwan)', 'CN'], ['China', 'CN'], ['New Zealand', 'NZ'],
  ['Philippines', 'PH'], ['Vietnam', 'VN'], ['South Korea', 'KR'], ['Korea, Republic of (South)', 'KR'], ['Hong Kong', 'HK'],
  ['United States', 'US'], ['United Kingdom', 'GB'], ['Italy', 'IT'], ['Germany', 'DE'], ['Malaysia', 'MY'], ['Sri Lanka', 'LK'],
  ['South Africa', 'ZA'], ['Nepal', 'NP'], ['Japan', 'JP'], ['Singapore', 'SG'], ['Greece', 'GR'], ['Türkiye', 'TR'], ['Scotland', 'GB_SCT'],
  ['Australia', 'AU'], ['Netherlands', 'NL'], ['Korea', 'KR'],
] as const) assert.equal(flagCode(name), code, name);
for (const name of ['Total', 'Other Americas', 'Polynesia (excludes Hawaii), nec', 'Not stated/Inadequately described']) assert.equal(flagCode(name), null, name);
console.log('flags.check: ok');
