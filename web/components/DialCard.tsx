import Link from 'next/link';
import Dial, { type DialProps } from './Dial';

type DialCardProps = DialProps & {
  href: string;
  kicker?: string;
  tier?: string;
};

export default function DialCard({ href, kicker, tier, id, ...dial }: DialCardProps) {
  return (
    <Link href={href} className="dial-card">
      {kicker && <div className="dial-card-kicker">{kicker}</div>}
      <Dial id={id} {...dial} />
      {tier && <div className="dial-card-tier">{tier}</div>}
      <div className="dial-card-cta">How this is built →</div>
    </Link>
  );
}
