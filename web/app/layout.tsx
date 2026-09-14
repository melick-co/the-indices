import './globals.css';
import type { Metadata } from 'next';
import { IBM_Plex_Mono, Newsreader, Source_Sans_3, Source_Serif_4 } from 'next/font/google';
import { SiteShell } from '@/components/SiteShell';

const newsreader = Newsreader({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-newsreader',
  style: ['normal', 'italic'],
});

const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-source-serif',
  style: ['normal', 'italic'],
});

const sourceSans = Source_Sans_3({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-source-sans',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500'],
  variable: '--font-plex',
});

export const metadata: Metadata = {
  title: 'Caveat — the detail that changes the story',
  description:
    'Caveat reads the same data as everyone else and finds the detail that changes the story. Every claim resolves to a named source you can check.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en-AU"
      className={`${newsreader.variable} ${sourceSerif.variable} ${sourceSans.variable} ${plexMono.variable}`}
    >
      <body>
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  );
}
