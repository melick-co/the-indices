export default function WageSpiral({ Figure }: { Figure: React.ComponentType }) {
  return (
    <>
      <p>
        From 1 July the national minimum wage rose to $26.44 an hour, past $1,000 a
        week for the first time, with award rates up 4.75% for around 2.8 million
        workers. Within days the warning arrived on every feed: inflation is about to
        spiral out of control.
      </p>
      <p>
        The documents behind those posts are real. The wage decision is real. The IMF
        did warn about a prolonged closure of the Strait of Hormuz. What is missing is
        the record of what happened the last five times.
      </p>

      <Figure />

      <div className="layers">
        <div className="layer">
          <p>
            2022 brought the biggest rise in a decade, 4.6% on awards, and the spiral
            warnings began. Inflation fell over the following year. 2023 brought
            another large rise, 5.75%, and louder warnings. Inflation fell again, from
            6.0% to 3.8%.
          </p>
        </div>
        <div className="layer">
          <p>
            Then the pattern ran the other way. The 2025 decision was the smallest of
            the era at 3.5%. Inflation rose, from 2.1% to 3.8%, driven by energy
            subsidies rolling off and an oil shock, not by pay.
          </p>
        </div>
        <div className="layer">
          <p>
            The regulator has measured this directly. In its 2025 decision the Fair
            Work Commission reported that the previous year&rsquo;s increase contributed
            0.36 of a percentage point to the Wage Price Index. Around a tenth of total
            wage growth, from the decision that was going to set off a spiral.
          </p>
        </div>
      </div>

      <div className="pull">
        0.36 of a percentage point. That is what the last &ldquo;inflationary&rdquo;
        wage rise added to wage growth, measured by the body that set it.
      </div>

      <h2>The causation runs the other way</h2>
      <p>
        The Commission raises wages most when inflation has already eaten them. This
        year it explicitly cited the reopened gap between prices and pay, and the same
        Middle East oil risk the warnings quote. Treating the response as the cause
        reads the sequence backwards.
      </p>
      <p>
        To be fair to the argument: a 4.75% rise for a fifth of the workforce while
        inflation runs near 4% is a legitimate thing for economists to disagree about,
        and interest rates did much of the disinflation work in 2023 and 2024. But six
        consecutive years of spiral predictions have produced no spiral, and the one
        number the regulator publishes suggests why.
      </p>
    </>
  );
}
