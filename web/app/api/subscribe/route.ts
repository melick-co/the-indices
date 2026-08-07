import { NextResponse } from 'next/server';

/** Email capture. Stores via Resend audiences when configured; otherwise logs so
 *  the form never blocks a reader. Swap in your provider of choice. */
export async function POST(request: Request) {
  const { email } = await request.json().catch(() => ({ email: null }));
  if (!email || !String(email).includes('@'))
    return NextResponse.json({ ok: false }, { status: 400 });

  const key = process.env.RESEND_API_KEY;
  const audience = process.env.RESEND_AUDIENCE_ID;
  if (key && audience) {
    try {
      await fetch(`https://api.resend.com/audiences/${audience}/contacts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ email, unsubscribed: false }),
      });
    } catch (e) {
      console.error('subscribe failed', e);
    }
  } else {
    console.log('subscribe (no provider configured):', email);
  }
  return NextResponse.json({ ok: true });
}
