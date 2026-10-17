import { notFound } from 'next/navigation';
import { GovPnlEmpty, GovPnlView } from '@/components/dashboard/GovPnl';
import { PnlView } from '@/components/dashboard/Pnl';
import { loadGovPnl } from '@/lib/gov-pnl';
import { loadPnl } from '@/lib/pnl';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Australia Inc.: the country\'s profit and loss — Caveat Indices',
  description: 'The national accounts read as a profit and loss statement: what Australia earns, pays out, spends and keeps. Below it, the government\'s own profit and loss.',
};

export default async function AustraliaIncPage() {
  const [d, gov] = await Promise.all([loadPnl(), loadGovPnl().catch(() => null)]);
  if (!d) notFound();
  return <PnlView d={d}>{gov ? <GovPnlView d={gov} /> : <GovPnlEmpty />}</PnlView>;
}
