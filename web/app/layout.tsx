import './globals.css';
import type { Metadata } from 'next';
import { SiteShell } from '@/components/SiteShell';

export const metadata: Metadata = {
  title: 'Caveat — the detail that changes the story',
  description:
    'Caveat reads the same data as everyone else and finds the detail that changes the story. Every claim resolves to a named source you can check.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <body>
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  );
}
