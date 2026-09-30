import './globals.css';
import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { SiteShell } from '@/components/SiteShell';

// Self-hosted (SIL OFL, see app/fonts/README.md) so builds never depend on
// fonts.gstatic.com. Latin subset, same weights the Google loader used.
const newsreader = localFont({
  src: [
    { path: './fonts/newsreader-roman.woff2', weight: '400 700', style: 'normal' },
    { path: './fonts/newsreader-italic.woff2', weight: '400 700', style: 'italic' },
  ],
  display: 'swap',
  variable: '--font-newsreader',
  adjustFontFallback: 'Times New Roman',
});

const sourceSerif = localFont({
  src: './fonts/source-serif-4.woff2',
  weight: '400 600',
  display: 'swap',
  variable: '--font-source-serif',
  adjustFontFallback: 'Times New Roman',
});

const sourceSans = localFont({
  src: './fonts/source-sans-3.woff2',
  weight: '400 600',
  display: 'swap',
  variable: '--font-source-sans',
});

const plexMono = localFont({
  src: [
    { path: './fonts/ibm-plex-mono-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/ibm-plex-mono-500.woff2', weight: '500', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-plex',
});

const inter = localFont({
  src: './fonts/inter.woff2',
  weight: '400 600',
  display: 'swap',
  variable: '--font-geist',
});

export const metadata: Metadata = {
  title: 'The Caveat — the detail that changes the story',
  description:
    'The Caveat reads the same data as everyone else and finds the detail that changes the story. Every claim resolves to a named source you can check.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en-AU"
      className={`${newsreader.variable} ${sourceSerif.variable} ${sourceSans.variable} ${plexMono.variable} ${inter.variable}`}
    >
      <body>
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  );
}
