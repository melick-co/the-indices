import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/** Inbound editorial email webhook (Resend Inbound or manual POST).
 *  Stores in inbox for run-email-review.mjs — never auto-applies suggestions. */
export async function POST(request: Request) {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) {
    return NextResponse.json({ ok: false, error: 'database not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  // Resend inbound: { type, data: { from, to, subject, text, html, message_id } }
  const data = body.data ?? body;
  const from = String(data.from ?? data.from_address ?? '').trim();
  const subject = String(data.subject ?? '').trim() || '(no subject)';
  const text = String(data.text ?? data.body ?? '').trim();
  const html = String(data.html ?? '');
  const messageId = String(data.message_id ?? data.messageId ?? '').trim() || null;
  const link = extractFirstUrl(text || html);

  const plain = text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!plain && !link) {
    return NextResponse.json({ ok: false, error: 'empty email body' }, { status: 400 });
  }

  const supabase = createClient(url, service, { auth: { persistSession: false } });

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

function extractFirstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"')\]]+/i);
  return m?.[0] ?? null;
}
