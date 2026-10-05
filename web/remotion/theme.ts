/**
 * The house look, as the site's globals.css sets it: raw paper, charcoal ink, the masthead navy as
 * the one highlight inside graphics, muted grey for everything else (NEWS-STYLE.md 4.4).
 */
export const PAPER = '#f3efe4';
export const INK = '#1a1612';
export const CHARCOAL = '#3c3832';
export const FOSSIL = '#6f685e';
export const RULE = '#2a2420';
export const NAVY = '#1d2a48';
export const MUTED = '#b9b2a6';

/** Family names as the font loader registers them. */
export const FONT = {
  display: 'Newsreader',
  body: 'Source Serif 4',
  ui: 'Source Sans 3',
  mono: 'IBM Plex Mono',
  masthead: 'UnifrakturMaguntia',
};

/** Burned-in text has to clear the platform's own chrome on a phone: a title bar above, controls below. */
export const SAFE = { x: 96, top: 230, bottom: 330 };

export const FRAME_WIDTH = 1080;
export const CONTENT_WIDTH = FRAME_WIDTH - SAFE.x * 2;
