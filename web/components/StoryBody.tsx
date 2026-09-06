import type { StoryBody as StoryBodyType } from '@/lib/story-types';

export default function StoryBody({ body }: { body: StoryBodyType }) {
  return (
    <>
      {body.blocks.map((block, i) => {
        switch (block.type) {
          case 'paragraph':
            return <p key={i}>{block.text}</p>;
          case 'layers':
            return (
              <div className="layers" key={i}>
                {block.items.map((text, j) => (
                  <div className="layer" key={j}><p>{text}</p></div>
                ))}
              </div>
            );
          case 'heading':
            return <h2 key={i}>{block.text}</h2>;
          case 'pull':
            return <div className="pull" key={i}>{block.text}</div>;
          default:
            return null;
        }
      })}
    </>
  );
}
