import type { StoryBody as StoryBodyType } from '@/lib/story-types';
import StoryChart from '@/components/StoryChart';
import StoryTimeline from '@/components/StoryTimeline';
import Footnoted from '@/components/Footnoted';

export default function StoryBody({ body }: { body: StoryBodyType }) {
  return (
    <>
      {body.blocks.map((block, i) => {
        switch (block.type) {
          case 'paragraph':
            return <p key={i} className={block.role ? `p-${block.role}` : undefined}><Footnoted text={block.text} /></p>;
          case 'layers':
            return (
              <div className="layers" key={i}>
                {block.items.map((text, j) => (
                  <div className="layer" key={j}><p><Footnoted text={text} /></p></div>
                ))}
              </div>
            );
          case 'heading':
            return <h2 key={i}>{block.text}</h2>;
          case 'pull':
            return <div className="pull" key={i}><Footnoted text={block.text} /></div>;
          case 'quote':
            // Only verified quotes are stored for publishing; guard anyway.
            if (!block.verified) return null;
            return (
              <blockquote className="story-quote" key={i}>
                <p>&ldquo;{block.text}&rdquo;</p>
                <footer>
                  {block.speaker}{block.title ? `, ${block.title}` : ''}
                  {block.footnote ? <sup className="fn-ref"><a href={`#fn-${block.footnote}`} aria-label={`Source ${block.footnote}`}>{block.footnote}</a></sup> : null}
                </footer>
              </blockquote>
            );
          case 'timeline':
            return <StoryTimeline key={i} block={block} />;
          case 'chart':
            return <StoryChart key={i} chart={block} />;
          default:
            return null;
        }
      })}
    </>
  );
}
