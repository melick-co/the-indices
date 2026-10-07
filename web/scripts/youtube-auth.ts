/**
 * One-time YouTube sign-in: makes the refresh token the poster uses. Run it yourself, in your own terminal:
 *
 *   YOUTUBE_CLIENT_ID=... YOUTUBE_CLIENT_SECRET=... npx tsx scripts/youtube-auth.ts
 *
 * It opens Google's consent page for the channel you choose, catches the reply on http://127.0.0.1:53682, and prints
 * the channel it signed in to and the refresh token. Put the token in GitHub (and Vercel) as YOUTUBE_REFRESH_TOKEN.
 * The token is printed only to your terminal; nothing is saved or sent anywhere else.
 */
import { createServer } from 'node:http';
import { exec } from 'node:child_process';

const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const id = process.env.YOUTUBE_CLIENT_ID?.trim(), secret = process.env.YOUTUBE_CLIENT_SECRET?.trim();
if (!id || !secret) {
  console.error('Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET first (from the OAuth client in Google Cloud).');
  process.exit(1);
}
const state = Math.random().toString(36).slice(2);
const consent = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
  client_id: id, redirect_uri: REDIRECT, response_type: 'code', access_type: 'offline', prompt: 'consent', state,
  // Upload, and change a video's publish time or privacy.
  scope: 'https://www.googleapis.com/auth/youtube',
})}`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', REDIRECT);
  if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
  const code = url.searchParams.get('code');
  if (url.searchParams.get('state') !== state || !code) {
    res.writeHead(400).end(`Sign-in failed: ${url.searchParams.get('error') ?? 'bad reply'}`);
    return;
  }
  try {
    const tok = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: REDIRECT, grant_type: 'authorization_code' }),
    }).then((r) => r.json()) as { refresh_token?: string; access_token?: string; error_description?: string };
    if (!tok.refresh_token || !tok.access_token) throw new Error(tok.error_description ?? 'no refresh token returned');
    const ch = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { authorization: `Bearer ${tok.access_token}` } })
      .then((r) => r.json()) as { items?: { id: string; snippet: { title: string } }[] };
    const channel = ch.items?.[0];
    res.writeHead(200, { 'content-type': 'text/plain' }).end(`Signed in to ${channel?.snippet.title ?? 'YouTube'}. You can close this tab and go back to the terminal.`);
    console.log(`\nSigned in to the channel: ${channel ? `${channel.snippet.title} (${channel.id})` : 'unknown (no channel on this account?)'}`);
    console.log('\nYOUTUBE_REFRESH_TOKEN (add it as a secret in GitHub, and in Vercel for instant reschedules; do not share it):\n');
    console.log(tok.refresh_token);
  } catch (e) {
    res.writeHead(500).end('Sign-in failed; see the terminal.');
    console.error(`Sign-in failed: ${e instanceof Error ? e.message : e}`);
  } finally {
    server.close();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Opening Google sign-in. If it doesn't open, visit:\n\n${consent}\n`);
  exec(`${process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open'} "${consent}"`);
});
