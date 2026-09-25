import assert from 'node:assert/strict';
import { appendContextTakeaways, formatYoutubeTakeaways, formatYoutubeUnavailable } from './context-takeaways';
import { parseCaptionXml, youtubeVideoId } from './youtube-transcript';

assert.equal(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
assert.equal(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
assert.equal(youtubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
assert.equal(youtubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
assert.equal(youtubeVideoId('https://www.youtube.com/live/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
assert.equal(youtubeVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=12s'), 'dQw4w9WgXcQ');
assert.equal(youtubeVideoId('https://the-indices.vercel.app/foundry'), null);
assert.equal(youtubeVideoId('not a url'), null);
assert.equal(youtubeVideoId('youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
assert.equal(youtubeVideoId('www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');

assert.match(
  formatYoutubeUnavailable('Cash rate briefing', 'https://youtu.be/dQw4w9WgXcQ', 'YouTube blocked the transcript request from this host.'),
  /Could not transcribe captions/,
);

const xml = '<transcript><text start="0" dur="1">Hey &amp; there</text><text start="1" dur="1">how are you</text></transcript>';
assert.equal(parseCaptionXml(xml), 'Hey & there how are you');

const takeaways = formatYoutubeTakeaways('Cash rate briefing', [
  '- The cash rate stayed at 4.35%',
  'The board will meet again in November',
]);
assert.equal(takeaways, 'Key takeaways from Cash rate briefing:\n- The cash rate stayed at 4.35%\n- The board will meet again in November');

assert.equal(appendContextTakeaways('', takeaways), takeaways);
assert.equal(
  appendContextTakeaways('Look at household debt.', takeaways),
  `Look at household debt.\n\n${takeaways}`,
);

console.log('youtube-transcript.check: ok');
