import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';
import { FONT } from './theme';

/**
 * The site's own font files (web/app/fonts), copied into the bundle's public folder by the render
 * script. Loaded once per page; the loader ignores a repeat call for the same face.
 */
export const FONT_FILES = [
  'newsreader-roman.woff2',
  'newsreader-italic.woff2',
  'source-serif-4.woff2',
  'source-sans-3.woff2',
  'ibm-plex-mono-400.woff2',
  'ibm-plex-mono-500.woff2',
  'unifraktur-maguntia.woff2',
];

export async function loadFonts(): Promise<void> {
  await Promise.all([
    loadFont({ family: FONT.display, url: staticFile('fonts/newsreader-roman.woff2'), weight: '400 700', style: 'normal' }),
    loadFont({ family: FONT.display, url: staticFile('fonts/newsreader-italic.woff2'), weight: '400 700', style: 'italic' }),
    loadFont({ family: FONT.body, url: staticFile('fonts/source-serif-4.woff2'), weight: '400 600' }),
    loadFont({ family: FONT.ui, url: staticFile('fonts/source-sans-3.woff2'), weight: '400 600' }),
    loadFont({ family: FONT.mono, url: staticFile('fonts/ibm-plex-mono-400.woff2'), weight: '400' }),
    loadFont({ family: FONT.mono, url: staticFile('fonts/ibm-plex-mono-500.woff2'), weight: '500' }),
    loadFont({ family: FONT.masthead, url: staticFile('fonts/unifraktur-maguntia.woff2'), weight: '400' }),
  ]);
}
