import Sidebar from './Sidebar';

export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="site-shell">
      <Sidebar />
      <div className="site-main">{children}</div>
    </div>
  );
}
