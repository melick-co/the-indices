'use client';

import { usePathname } from 'next/navigation';
import { isIndicesPath, isOpsPath } from '@/lib/ops-paths';
import IndicesShell from './indices/IndicesShell';
import OpsNav from './OpsNav';
import Sidebar from './Sidebar';

export function SiteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  if (isIndicesPath(pathname)) return <IndicesShell>{children}</IndicesShell>;
  const ops = isOpsPath(pathname);

  return (
    <div className={ops ? 'site-shell site-shell--ops' : 'site-shell'}>
      {ops ? <OpsNav /> : <Sidebar />}
      <div className="site-main">{children}</div>
    </div>
  );
}
