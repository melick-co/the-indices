'use client';

import { useRouter } from 'next/navigation';
import ReelControls, { type ReelLink } from '@/components/ReelControls';

export default function ReelActions({ slug, reel }: { slug: string; reel?: ReelLink | null }) {
  const router = useRouter();
  return <ReelControls slug={slug} reel={reel} onDone={() => router.refresh()} />;
}
