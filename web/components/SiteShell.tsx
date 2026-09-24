'use client';

import { usePathname } from 'next/navigation';
import { isOpsPath } from '@/lib/ops-paths';
import OpsNav from './OpsNav';
import Sidebar from './Sidebar';

export function SiteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const ops = isOpsPath(pathname);

  return (
    <div className={ops ? 'site-shell site-shell--ops' : 'site-shell'}>
      {ops ? <OpsNav /> : <Sidebar />}
      <div className="site-main">{children}</div>
    </div>
  );
}
