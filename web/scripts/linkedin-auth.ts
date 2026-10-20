/**
 * One-time LinkedIn sign-in: makes the refresh token the poster uses. Run it yourself, in your own terminal:
 *
 *   LINKEDIN_CLIENT_ID=... LINKEDIN_CLIENT_SECRET=... npx tsx scripts/linkedin-auth.ts
 *
 * Before you run it, in the LinkedIn Developer Portal (https://www.linkedin.com/developers/apps):
 *   1. The app is linked to The Caveat's Company Page and the page has verified the app (Settings tab).
 *   2. The Community Management API product is granted (Products tab; it starts on the Development tier).
 *   3. http://localhost:53683/callback is listed under Authorized redirect URLs (Auth tab).
 * Sign in as a member who is an ADMINISTRATOR or CONTENT_ADMIN of the page.
 *
 * It opens LinkedIn's consent page (scopes w_organization_social r_organization_social), catches the reply on
 * http://localhost:53683, swaps the code for tokens, and prints the refresh token (365 days from now; run this again
 * before then). If LinkedIn returns no refresh token (programmatic refresh tokens are for approved apps only), it
 * prints the 60-day access token instead. Tokens are printed only to your terminal; nothing is saved or sent anywhere
 * else. Docs: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
 */
import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const PORT = 53683;
const REDIRECT = `http://localhost:${PORT}/callback`;
const SCOPES = ['w_organization_social', 'r_organization_social'];
const id = process.env.LINKEDIN_CLIENT_ID?.trim(), secret = process.env.LINKEDIN_CLIENT_SECRET?.trim();
if (!id || !secret) {
  console.error('Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET first (Auth tab of the app in the LinkedIn Developer Portal).');
  process.exit(1);
}
const state = randomBytes(16).toString('hex');
const consent = `https://www.linkedin.com/oauth/v2/authorization?${new URLSearchParams({
  response_type: 'code', client_id: id, redirect_uri: REDIRECT, state, scope: SCOPES.join(' '),
})}`;
const days = (s?: number) => (s ? `${Math.round(s / 86400)} days` : 'unknown');

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', REDIRECT);
  if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
  const code = url.searchParams.get('code');
  if (url.searchParams.get('state') !== state || !code) {
    res.writeHead(400).end(`Sign-in failed: ${url.searchParams.get('error_description') ?? url.searchParams.get('error') ?? 'bad reply'}`);
    server.close();
    return;
  }
  try {
    const tok = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: id, client_secret: secret, redirect_uri: REDIRECT }),
    }).then((r) => r.json()) as { access_token?: string; expires_in?: number; refresh_token?: string; refresh_token_expires_in?: number; scope?: string; error_description?: string };
    if (!tok.access_token) throw new Error(tok.error_description ?? 'no access token returned');
    res.writeHead(200, { 'content-type': 'text/plain' }).end('Signed in to LinkedIn. You can close this tab and go back to the terminal.');
    console.log(`\nGranted scopes: ${tok.scope ?? '(not stated)'}`);
    if (tok.refresh_token) {
      console.log(`\nLINKEDIN_REFRESH_TOKEN (valid ${days(tok.refresh_token_expires_in)}; add it as a secret in GitHub and in Vercel; do not share it):\n`);
      console.log(tok.refresh_token);
    } else {
      console.log('\nLinkedIn returned no refresh token (programmatic refresh tokens are for approved apps).');
      console.log(`LINKEDIN_ACCESS_TOKEN (valid ${days(tok.expires_in)}; store it in GitHub and Vercel instead, and run this again before it lapses):\n`);
      console.log(tok.access_token);
    }
    console.log(`
LINKEDIN_ORG_URN: urn:li:organization:{id}. The id is the number in your Company Page's admin address,
https://www.linkedin.com/company/{id}/admin/ (open the page as an admin and look at the browser's address bar).
Store it as LINKEDIN_ORG_URN, for example urn:li:organization:12345678, in GitHub and Vercel.`);
  } catch (e) {
    res.writeHead(500).end('Sign-in failed; see the terminal.');
    console.error(`Sign-in failed: ${e instanceof Error ? e.message : e}`);
  } finally {
    server.close();
  }
});

server.listen(PORT, 'localhost', () => {
  console.log(`Opening LinkedIn sign-in. If it doesn't open, visit:\n\n${consent}\n`);
  exec(`${process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open'} "${consent}"`);
});
