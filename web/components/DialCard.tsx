import Link from 'next/link';
import Dial, { type DialProps } from './Dial';
import Sparkline, { type SparkPoint } from './Sparkline';

type DialCardProps = DialProps & {
  href: string;
  kicker?: string;
  tier?: string;
  /** Recent history, oldest first. Rendered as a sparkline under the gauge. */
  spark?: SparkPoint[];
  step?: boolean;
  /** Movement on the previous observation, already formatted. */
  change?: string;
  /** Shown when the latest reading is well behind today. */
  age?: string;
};

export default function DialCard({
  href, kicker, tier, spark, step, change, age, id, ...dial
}: DialCardProps) {
  return (
    <Link href={href} className="dial-card">
      {kicker && <div className="dial-card-kicker">{kicker}</div>}
      <Dial id={id} {...dial} />
      {change && <div className="dial-change">{change}</div>}
      {spark && spark.length > 1 && (
        <Sparkline points={spark} label={dial.label} step={step} />
      )}
      {age && <div className="dial-age">{age}</div>}
      {tier && <div className="dial-card-tier">{tier}</div>}
      <div className="dial-card-cta">How this is built →</div>
    </Link>
  );
}
