/** Regular economics explainers. Objective, checkable, for readers who do not live in the jargon. */
export type Explainer = {
  slug: string;
  title: string;
  deck: string;
  kicker: string;
  published: string;
  readMins: number;
  sections: { heading: string; paragraphs: string[] }[];
  further?: { label: string; href: string }[];
};

export const EXPLAINERS: Explainer[] = [
  {
    slug: 'productivity',
    title: 'Productivity is not a sermon about hard work',
    deck: 'It is output per hour, not hours worked. The level can look fine while the growth has stalled.',
    kicker: 'Explainer · Productivity',
    published: '2026-09-01',
    readMins: 6,
    sections: [
      {
        heading: 'What the word actually means',
        paragraphs: [
          'Labour productivity is how much real output an hour of work produces. Multifactor productivity asks the same question after you also account for the capital sitting under that hour: machines, software, buildings.',
          'It is a ratio. The top is output. The bottom is inputs. If the bottom grows as fast as the top, productivity is flat even if everyone is exhausted.',
        ],
      },
      {
        heading: 'What it is not',
        paragraphs: [
          'It is not "working harder." A longer shift raises output and hours together. The ratio can sit still. It is not a moral score. A miner with a bigger truck can be more productive than a nurse on a twelve-hour roster.',
          'It is also not wages. Pay can lag output for years. When that happens the gap is a distribution story, not a productivity story, and the two get glued together in press releases.',
        ],
      },
      {
        heading: 'Why it keeps turning up in Australian arguments',
        paragraphs: [
          'Treasury and the Reserve Bank use productivity growth as the speed limit on real wages that does not raise prices. If that speed limit has been crawling, a pay rise that looks modest on a poster can still be described as "unaffordable."',
          'The honest move is to publish the level and the growth. Australia can sit high on the first and weak on the second. That is a two-truths gap, not a contradiction.',
        ],
      },
    ],
    further: [
      { label: 'ABS estimates of industry multifactor productivity', href: 'https://www.abs.gov.au/statistics/industry/industry-overview/estimates-industry-multifactor-productivity' },
    ],
  },
  {
    slug: 'gdp',
    title: 'GDP is a scoreboard. It is not a living standard.',
    deck: 'Gross domestic product counts activity on a territory. It does not say who received the activity, or whether anyone could afford a house.',
    kicker: 'Explainer · GDP',
    published: '2026-09-04',
    readMins: 6,
    sections: [
      {
        heading: 'The three ways to count the same pile',
        paragraphs: [
          'Production: the value added by farms, mines, factories, hospitals, apps. Income: wages, profits and taxes on production. Expenditure: consumption plus investment plus government plus net exports. In the textbooks they reconcile. In the releases they wobble and get revised.',
          'Nominal GDP is this year\'s prices. Real GDP holds prices still so you can see volume. Most "the economy grew" headlines mean real GDP. Most "we can afford this" arguments quietly switch to nominal.',
        ],
      },
      {
        heading: 'The division sign they leave off the graphic',
        paragraphs: [
          'A country can grow because it produced more per person, or because it added people. Both raise the headline. Only the first raises average material living standards. GDP per capita is the version that belongs next to wages and housing.',
          'Even per capita is not welfare. It ignores home production, leisure, distribution and the destruction you will have to rebuild. A flood and the rebuild can both look like activity.',
        ],
      },
      {
        heading: 'How to read an Australian print',
        paragraphs: [
          'Ask three questions. Is it real or nominal? Is it total or per person? Which quarter, and has it been revised? The national accounts are a camera with a delay and a habit of changing last year\'s photo.',
        ],
      },
    ],
    further: [
      { label: 'ABS Australian National Accounts', href: 'https://www.abs.gov.au/statistics/economy/national-accounts' },
    ],
  },
  {
    slug: 'bonds',
    title: 'A bond is a loan with a published price for waiting',
    deck: 'The yield is not a vibe. It is the return you lock in if you buy the paper today and hold it to the date on the tin.',
    kicker: 'Explainer · Bonds',
    published: '2026-09-08',
    readMins: 7,
    sections: [
      {
        heading: 'What you are actually buying',
        paragraphs: [
          'A government bond is a loan to the Treasury. You hand over money now. You receive coupons on a schedule and the face value back on a date. Australian Government Securities are that loan in Australian dollars, issued by the AOFM.',
          'The coupon is fixed when the bond is born. The price is not. After issue the paper trades. If the price falls, the yield to maturity rises. They are the same seesaw.',
        ],
      },
      {
        heading: 'Yield, cash rate, and your mortgage are not one number',
        paragraphs: [
          'The cash rate is overnight money between banks. A ten-year yield is the market\'s price for lending to the Commonwealth until 2036. Your mortgage is a retail contract on top of wholesale funding, credit risk and a bank\'s margin.',
          'They move together often enough that television treats them as twins. They are cousins. A rate hold can sit next to a rising ten-year yield if the world has decided inflation or supply of paper has changed.',
        ],
      },
      {
        heading: 'The bill versus the stock',
        paragraphs: [
          'The interest the budget pays this year is a cash bill. The face value on issue is a stock. Mixing them produces those "we spend more on interest than on schools" lines that skip the denominator and the term structure.',
          'If you want the household comparison, put the interest bill next to a tax the public already understands, or put the stock next to GDP. Do not put a flow next to a stock and call it a race.',
        ],
      },
    ],
    further: [
      { label: 'AOFM, Australian Government Securities', href: 'https://www.aofm.gov.au/' },
    ],
  },
  {
    slug: 'inflation',
    title: 'Inflation is a rate. The shop is a level.',
    deck: 'The CPI says how fast a basket is rising. It does not refund last year\'s prices, and it is not your particular trolley.',
    kicker: 'Explainer · Inflation',
    published: '2026-09-11',
    readMins: 6,
    sections: [
      {
        heading: 'A rate of change, not a receipt',
        paragraphs: [
          'Headline CPI is the annual change in a weighted basket of goods and services. If it falls from 6% to 3%, prices are still rising. They are rising more slowly. The level you pay is higher than two years ago unless something has actually been cut.',
          'Trimmed mean and weighted median throw out the noisiest items so the Reserve Bank can see the middle of the distribution. That is useful for a cash-rate decision. It is a poor description of rent.',
        ],
      },
      {
        heading: 'Why your life disagrees with the average',
        paragraphs: [
          'Weights are national. If you rent in a capital city and drive a car, your personal inflation can sit above the headline for a long time. If you own outright and do not commute, it can sit below.',
          'Living-cost indexes exist for that reason. They are not the target the Bank is required to hit. Mixing the two is how a press conference and a kitchen table end up shouting past each other.',
        ],
      },
      {
        heading: 'Real means "after this number"',
        paragraphs: [
          'A wage rise minus CPI is a rough real wage. A bond yield minus CPI is a rough real yield. Both are only as honest as the price index you picked. Use the same index when you compare years. Say when you switch.',
        ],
      },
    ],
    further: [
      { label: 'ABS Consumer Price Index', href: 'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/consumer-price-index-australia' },
    ],
  },
];
