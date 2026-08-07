export default function Migration({ Figure }: { Figure: React.ComponentType }) {
  return (
    <>
      <p>
        You have seen the chart. The United States takes more permanent migrants than
        any country on earth, 1.43 million in 2024. Germany, Canada and the United
        Kingdom follow. Australia sits eighth. Every version of this chart, shared
        endlessly, ranks countries the same way.
      </p>
      <div className="layers">
        <div className="layer">
          <p>
            A country of 340 million taking 1.4 million people is not doing the same
            thing as a country of 5 million taking 72,000. The first chart measures the
            size of an economy. It cannot tell you how open a country is, because it
            never divides by anything.
          </p>
        </div>
        <div className="layer">
          <p>
            Divide by population and the board reorders. The United States falls from
            first to 26th of 38. Japan drops to 35th. Luxembourg, 30th on the raw
            numbers, is first per person at 39 migrants per thousand residents.
            Iceland is second.
          </p>
        </div>
        <div className="layer">
          <p>
            Australia is the rare case where both framings roughly agree: eighth by
            volume, 14th per person, at 8.8 per thousand against an OECD average near
            nine. On the measure that actually describes openness, Australia is
            unremarkable, which tends to surprise both sides of its migration argument.
          </p>
        </div>
      </div>

      <Figure />

      <h2>Why the framing keeps happening</h2>
      <p>
        Absolute counts are easier to source, easier to headline, and produce a chart
        where the largest economies sit on top, which reads as intuitive. The
        per-person version requires one extra step and produces a ranking dominated
        by countries most readers were not thinking about.
      </p>
      <div className="pull">
        Openness is a per-person question. Almost every ranking you have seen answers
        a different one.
      </div>
      <p>
        None of this makes the raw numbers wrong. Absolute intake matters for
        infrastructure, housing and services. It just is not a measure of how open a
        country is, and it is routinely presented as though it were.
      </p>
    </>
  );
}
