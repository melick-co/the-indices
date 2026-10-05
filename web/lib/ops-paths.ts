/** Internal desks. These use the clinical ops chrome, not the broadsheet. */
export function isOpsPath(pathname: string): boolean {
  if (pathname === '/foundry' || pathname.startsWith('/foundry/')) return true;
  if (pathname === '/studio' || pathname.startsWith('/studio/')) return true;
  if (pathname === '/account' || pathname.startsWith('/account/')) return true;
  if (pathname === '/login' || pathname.startsWith('/login/')) return true;
  if (pathname.startsWith('/auth/')) return true;
  if (pathname === '/metrics' || pathname.startsWith('/metrics/')) return true;
  if (/^\/stories\/[^/]+\/reel(?:\/|$)/.test(pathname)) return true;
  return false;
}

/** The Indices: its own site (masthead and navigation), not the desk or the broadsheet. */
export function isIndicesPath(pathname: string): boolean {
  return pathname === '/indices' || pathname.startsWith('/indices/');
}
