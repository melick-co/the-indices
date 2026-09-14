import { createClient } from '@/lib/supabase-server';
import { STORY_ART_BUCKET } from '@/lib/story-art';
import { recordStoryArt } from '@/app/foundry/desk/actions';

export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function extFor(type: string, name: string) {
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/gif') return 'gif';
  const fromName = name.split('.').pop()?.toLowerCase();
  if (fromName && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(fromName)) return fromName;
  return 'jpg';
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const slug = String(form.get('slug') ?? '').trim();
    const alt = String(form.get('alt') ?? '').trim();
    const file = form.get('file');
    if (!slug) return Response.json({ message: 'Missing slug' }, { status: 400 });
    if (!(file instanceof File)) return Response.json({ message: 'Missing file' }, { status: 400 });
    if (!ALLOWED.has(file.type)) {
      return Response.json({ message: 'Use jpeg, png, webp, or gif' }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return Response.json({ message: 'File is over 10MB' }, { status: 400 });
    }

    const safeSlug = slug.replace(/[^a-z0-9-]/gi, '-').slice(0, 80);
    const path = `${safeSlug}/${Date.now()}.${extFor(file.type, file.name)}`;
    const buf = Buffer.from(await file.arrayBuffer());
    const supabase = createClient();
    const { error } = await supabase.storage.from(STORY_ART_BUCKET).upload(path, buf, {
      contentType: file.type,
      upsert: true,
    });
    if (error) return Response.json({ message: error.message }, { status: 400 });

    const { data } = supabase.storage.from(STORY_ART_BUCKET).getPublicUrl(path);
    const url = data.publicUrl;
    await recordStoryArt(slug, {
      kind: 'hero',
      url,
      alt: alt || undefined,
      source: 'upload',
    });
    return Response.json({ url, alt, path });
  } catch (e) {
    return Response.json(
      { message: e instanceof Error ? e.message : 'Upload failed' },
      { status: 400 },
    );
  }
}
