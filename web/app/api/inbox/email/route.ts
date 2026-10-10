import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import economists from '../../../../../agent/config/economists.json';

/** Inbound email webhook (Resend Inbound, or a manual POST with the bearer secret).
 *  Mail from an approved economist sender (agent/config/economists.json) goes to economist_notes for
 *  run-economist-review.mjs; anything else goes to the inbox for run-email-review.mjs. Nothing auto-applies.
 *  Every request must be signed by Resend (RESEND_WEBHOOK_SECRET) or carry INBOUND_EMAIL_SECRET; with
 *  neither configured the endpoint refuses everything. */
export async function POST(request: Request) {
  const raw = await request.text();
  if (!authorised(request, raw)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) {
    return NextResponse.json({ ok: false, error: 'database not configured' }, { status: 503 });
  }

  let body: Record<string, unknown> | null = null;
  try { body = JSON.parse(raw); } catch { /* handled below */ }
  if (!body) {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  // Resend inbound: { type: 'email.received', data: { email_id, from, to, subject, message_id, … } }; the body may
  // need fetching. A manual POST carries { from, subject, text|html }.
  const data = { ...((body.data ?? body) as Record<string, unknown>) };
  if (!data.text && !data.html && data.email_id) Object.assign(data, await receivedEmail(String(data.email_id)));

  const from = addressOf(data.from ?? data.from_address);
  const subject = String(data.subject ?? '').trim() || '(no subject)';
  const text = String(data.text ?? data.body ?? '').trim();
  const html = String(data.html ?? '');
  const messageId = String(data.message_id ?? data.messageId ?? data.email_id ?? '').trim() || null;
  const link = extractFirstUrl(text || html);

  const plain = text || html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!plain && !link) {
    return NextResponse.json({ ok: false, error: 'empty email body' }, { status: 400 });
  }

  const supabase = createClient(url, service, { auth: { persistSession: false } });

  const sender = economists.senders.find((s) => from.toLowerCase().includes(s.match.toLowerCase()));
  if (sender) {
    const { data: row, error } = await supabase.from('economist_notes').upsert({
      source_id: sender.id, source_kind: 'email', org: sender.org, title: subject, url: link,
      external_id: messageId ?? `${from}|${subject}`, published_at: new Date().toISOString(), body: plain.slice(0, 20000),
    }, { onConflict: 'source_id,external_id', ignoreDuplicates: true }).select('id').maybeSingle();
    if (error) {
      console.error('economist note insert failed', error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, economist: sender.id, note_id: row?.id ?? null, duplicate: !row });
  }

  if (messageId) {
    const { data: existing } = await supabase.from('inbox')
      .select('id').eq('message_id', messageId).maybeSingle();
    if (existing) {
      return NextResponse.json({ ok: true, duplicate: true, inbox_id: existing.id });
    }
  }

  const { data: row, error } = await supabase.from('inbox').insert({
    kind: 'email',
    title: subject,
    body: plain.slice(0, 20000),
    url: link,
    from_address: from || null,
    message_id: messageId,
    status: 'new',
  }).select('id').single();

  if (error) {
    console.error('inbox email insert failed', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inbox_id: row?.id });
}

/** A Resend (svix) signature over the raw body, or the bearer secret. */
function authorised(request: Request, raw: string): boolean {
  const bearer = process.env.INBOUND_EMAIL_SECRET;
  if (bearer && request.headers.get('authorization') === `Bearer ${bearer}`) return true;

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const id = request.headers.get('svix-id');
  const ts = request.headers.get('svix-timestamp');
  const sigs = request.headers.get('svix-signature');
  if (!secret || !id || !ts || !sigs) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest();
  return sigs.split(' ').some((part) => {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/** The text and html of a received email, which Resend's webhook leaves out. */
async function receivedEmail(id: string): Promise<{ text?: string; html?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return {};
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return {};
    const j = await res.json();
    return { text: j.text ?? undefined, html: j.html ?? undefined };
  } catch { return {}; }
}

/** "Name <a@b.com>", { email, name } or a bare address, as the address. */
function addressOf(v: unknown): string {
  if (v && typeof v === 'object') return String((v as { email?: string }).email ?? '').trim();
  const s = String(v ?? '').trim();
  return s.match(/<([^>]+)>/)?.[1] ?? s;
}

function extractFirstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"')\]]+/i);
  return m?.[0] ?? null;
}
