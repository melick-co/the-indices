import { notFound } from 'next/navigation';
import { PnlView } from '@/components/dashboard/Pnl';
import { loadPnl } from '@/lib/pnl';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Australia Inc.: the country\'s profit and loss — The Caveat’s Indices',
  description: 'The national accounts read as a profit and loss statement: what Australia earns, pays out, spends and keeps.',
};

export default async function AustraliaIncPage() {
  const d = await loadPnl();
  if (!d) notFound();
  return <PnlView d={d} />;
}
