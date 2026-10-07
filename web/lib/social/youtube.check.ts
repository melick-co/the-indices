import assert from 'node:assert/strict';
import { idFromUrl, shortUrl } from './youtube';

assert.equal(idFromUrl(shortUrl('dQw4w9WgXcQ')), 'dQw4w9WgXcQ');
assert.equal(idFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
assert.equal(idFromUrl('https://example.com/nothing'), null);
console.log('youtube.check: ok');
