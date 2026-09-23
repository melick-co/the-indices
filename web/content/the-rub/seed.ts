/** Regular Column 8. Measured, pedantic, James-May-voiced. Lands on a checkable caveat. */
export type RubPiece = {
  slug: string;
  title: string;
  keywords: string[];
  published: string;
  peg?: string;
  paragraphs: string[];
};

export const RUBS: RubPiece[] = [
  {
    slug: 'cash-rate-theatre',
    title: 'The cash rate held. That is not your mortgage.',
    keywords: ['rba', 'cash rate', 'interest rate', 'reserve bank', 'rate hold', 'rate cut', 'rate rise'],
    published: '2026-09-22',
    paragraphs: [
      'I do wish people would stop treating the cash rate as if it were a weather report for the household. It is an overnight rate between banks. It is not the thing on your statement, and it is certainly not the price of a house in a postcode you cannot afford.',
      'What the Reserve Bank actually sets is the cost of money for a few hours. What you pay is a contract written years ago, plus a bank margin, plus whatever you borrowed against a dwelling that only works if wages, prices and luck keep agreeing with each other. Those are different instruments. Mixing them up is how a Tuesday press conference becomes a national mood.',
      'Nobody went broke because the cash rate sat still for another meeting. They went broke because they treated a policy rate as a personal guarantee. If you want the household story, look at the debt, not the theatre.',
      'Which, if we are being precise, is the rub.',
    ],
  },
  {
    slug: 'migration-headcount',
    title: 'We counted the arrivals. We forgot to divide.',
    keywords: ['migration', 'immigration', 'nom', 'population', 'visa', 'asylum'],
    published: '2026-09-15',
    paragraphs: [
      'There is a habit, and I find it rather sloppy, of waving a very large number and calling it a conclusion. America takes the most migrants. Australia is "full". Someone has drawn an arrow. The comments then do what comments do.',
      'Absolute intake measures the size of an economy. Openness is a per-person question. Those are not the same chart, and they will not rank countries in the same order. The United States leads on the first measure and sits well down the list on the second. Australia looks different again once you stop treating a continent as a queue.',
      'If an argument cannot survive a division sign, it was not an argument. It was a poster with a number on it.',
      'Which, if we are being precise, is the rub.',
    ],
  },
  {
    slug: 'house-price-cheer',
    title: 'Your house went up. That is not the same as getting richer.',
    keywords: ['housing', 'house price', 'home', 'mortgage', 'property', 'rent'],
    published: '2026-09-08',
    paragraphs: [
      'People say "house prices are up again" with the quiet satisfaction usually reserved for a decent harvest. I should like to fuss about the vocabulary. A higher sticker on a house you still need to sleep in is a mood, not a dividend. If you do not own the thing, it is a locked door.',
      'A dwelling is not a share. You cannot spend a capital gain while you continue to occupy the asset. The stock is dear because we built too few of them and lent too much against the ones we have. That is not a productivity miracle. That is a queue with interest attached.',
      'The popular take calls this wealth. The receipt calls it a transfer from the young and the renting to whoever arrived first.',
      'Which, if we are being precise, is the rub.',
    ],
  },
  {
    slug: 'inflation-is-not-the-coles-receipt',
    title: 'Inflation fell. Your shop still hurts. Both can be true.',
    keywords: ['inflation', 'cpi', 'cost of living', 'prices', 'coles', 'woolworths'],
    published: '2026-09-01',
    paragraphs: [
      'The Consumer Price Index is a very polite average. It does not do your shopping, and it does not pay your rent. It weights a basket so that the country can have one number to wave at the Reserve Bank. That is a useful job. It is not a household ledger.',
      'When that number falls, television treats it as a refund. It is not. It means prices are rising more slowly than they were, from a higher floor, in a basket that is not your basket. Rent and insurance may still be having an evening of their own.',
      'The viral chart says inflation is beaten. The household asks why Tuesday costs more than Tuesday last year. The answer, I am afraid, is that a rate of change and a level are different animals, and we keep introducing them as twins.',
      'Which, if we are being precise, is the rub.',
    ],
  },
  {
    slug: 'gdp-grew-so-what',
    title: 'The economy grew. Did anyone you know?',
    keywords: ['gdp', 'economy', 'growth', 'recession', 'national accounts'],
    published: '2026-08-25',
    paragraphs: [
      'Gross domestic product is the country\'s favourite scoreboard, and like most scoreboards it is only as honest as the thing it is measuring. If the number is up, the treasurer smiles. If it is down, someone has to go on radio and say "technical." I have known speedometers that behaved like this when the wheels were the wrong size.',
      'GDP counts activity. It does not count who received the activity. A mining boom, a population surge and a rebuild after a flood all look like growth. One of them is a dividend. One of them is more people sharing the same pie. One of them is putting the house back. They are not interchangeable, however tidy the press release.',
      'Per person, the story often changes sign. That is the version that belongs on the front page. We print the other one because it is larger and, inconveniently, happier.',
      'Which, if we are being precise, is the rub.',
    ],
  },
  {
    slug: 'productivity-sermon',
    title: 'They said productivity. They meant you should work harder.',
    keywords: ['productivity', 'output', 'labour', 'wages', 'efficiency'],
    published: '2026-08-18',
    paragraphs: [
      'Productivity is the most abused word in Canberra after "sustainable," which is saying something. Properly used, it means more output from the same hours and kit. In the wild it means a lecture about lunch breaks, delivered by people who have never had to time one.',
      'Australia\'s level of output per hour is not the scandal. The scandal is how slowly that level has been moving, while houses, rents and the interest bill have been doing laps. If pay does not follow output, someone else collected the difference. That is not a sermon. That is arithmetic.',
      'Working longer is not productivity. That is simply a longer day. The chart you want is output per hour, not a homily about grit.',
      'Which, if we are being precise, is the rub.',
    ],
  },
];
