import type { CSSProperties, ReactNode } from 'react';

type FoundryIntent = 'investigate' | 'brainstorm' | 'refine' | 'precedents';

export default function StartSessionForm({
  intent,
  title,
  prompt,
  children,
  className,
  style,
}: {
  intent?: FoundryIntent;
  title?: string;
  prompt: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <form action="/foundry/work/start" method="post" style={{ display: 'inline' }}>
      {intent ? <input type="hidden" name="intent" value={intent} /> : null}
      {title ? <input type="hidden" name="title" value={title} /> : null}
      <input type="hidden" name="prompt" value={prompt} />
      <button type="submit" className={className} style={{ ...style, cursor: 'pointer' }}>
        {children}
      </button>
    </form>
  );
}
