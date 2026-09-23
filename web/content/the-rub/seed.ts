/** Regular Column 8. Satirical, Clarkson-voiced, lands on a checkable caveat. */
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
    title: 'The cash rate held. Nobody\'s mortgage noticed.',
    keywords: ['rba', 'cash rate', 'interest rate', 'reserve bank', 'rate hold', 'rate cut', 'rate rise'],
    published: '2026-09-22',
    paragraphs: [
      'Now look. I have sat through more rate-hold press conferences than is strictly healthy. Each time the same people appear on the evening news to announce that the price of money has not moved, as if this were a moon landing.',
      'Here is the bit they skip. The cash rate is what banks pay each other overnight. It is not your mortgage. It is not why a house costs twelve times a salary. It is a small lever on a machine that is mostly household debt and a very expensive postcode.',
      'The truth behind the shouting is that nobody went broke because the Reserve Bank sat on its hands for another Tuesday. They went broke because they borrowed against a house that only works if wages, prices and luck all run the same way.',
      'And that, ladies and gentlemen, is the rub.',
    ],
  },
  {
    slug: 'migration-headcount',
    title: 'We counted the arrivals. We forgot to divide.',
    keywords: ['migration', 'immigration', 'nom', 'population', 'visa', 'asylum'],
    published: '2026-09-15',
    paragraphs: [
      'Every few months a chart goes around with a very large number on it and a very small thought behind it. America takes the most migrants. Australia is "full". Someone has drawn an arrow. The comments are on fire.',
      'I am going to ruin the party. Absolute intake measures the size of an economy. Openness is a per-person question. The United States is first on the first measure and twenty-sixth on the second. Australia looks different again once you stop treating a continent as a queue.',
      'If your argument cannot survive a division sign, it was not an argument. It was a poster.',
      'And that, ladies and gentlemen, is the rub.',
    ],
  },
  {
    slug: 'house-price-cheer',
    title: 'Your house went up. That is not the same as getting richer.',
    keywords: ['housing', 'house price', 'home', 'mortgage', 'property', 'rent'],
    published: '2026-09-08',
    paragraphs: [
      'There is a special kind of national joy reserved for the sentence "house prices are up again." People say it the way other countries say "the harvest was good." I have news. If you already own the thing, a higher sticker is a mood. If you do not, it is a locked door.',
      'A dwelling is not a share. You cannot eat a capital gain while you still need somewhere to sleep. The stock is worth more because we built too few of them and lent too much against the ones we have. That is not a productivity miracle. That is a queue with interest.',
      'The trending take will tell you this is wealth. The receipt says it is a transfer from the young and the renting to whoever got there first.',
      'And that, ladies and gentlemen, is the rub.',
    ],
  },
  {
    slug: 'inflation-is-not-the-coles-receipt',
    title: 'Inflation fell. Your shop still hurts. Both can be true.',
    keywords: ['inflation', 'cpi', 'cost of living', 'prices', 'coles', 'woolworths'],
    published: '2026-09-01',
    paragraphs: [
      'The Consumer Price Index is a very polite average. It does not do your shopping. It does not pay your rent. It weights a basket so that the country can have one number to shout at the Reserve Bank.',
      'When that number falls, television treats it as a refund. It is not. It means prices are rising more slowly than they were, from a higher floor, in a basket that is not your basket. Rent and insurance can still be having a private party.',
      'The viral chart says "inflation is beaten." The household says "then why is Tuesday more expensive than Tuesday last year?" The answer is that a rate of change and a level are different animals, and we keep introducing them as twins.',
      'And that, ladies and gentlemen, is the rub.',
    ],
  },
  {
    slug: 'gdp-grew-so-what',
    title: 'The economy grew. Did anyone you know?',
    keywords: ['gdp', 'economy', 'growth', 'recession', 'national accounts'],
    published: '2026-08-25',
    paragraphs: [
      'Gross domestic product is the country\'s favourite scoreboard. If the number is up, the treasurer smiles. If it is down, someone has to go on radio and say "technical." I have driven cars that worked like this. The speedometer lies when the wheels are the wrong size.',
      'GDP counts activity. It does not count who got the activity. A mining boom, a population surge and a rebuild after a flood all look like growth. One of them is a dividend. One of them is more people sharing the same pie. One of them is just putting the house back.',
      'Per person, the story often changes sign. That is the version that belongs on the front page. We print the other one because it is larger and happier.',
      'And that, ladies and gentlemen, is the rub.',
    ],
  },
  {
    slug: 'productivity-sermon',
    title: 'They said productivity. They meant you should work harder.',
    keywords: ['productivity', 'output', 'labour', 'wages', 'efficiency'],
    published: '2026-08-18',
    paragraphs: [
      'Productivity is the most abused word in Canberra after "sustainable." It is supposed to mean more output from the same hours and kit. In the wild it means a lecture about lunch breaks.',
      'Australia\'s level of output per hour is not the scandal. The scandal is how slowly that level has been moving, while houses, rents and the interest bill have been doing laps. If pay does not follow output, someone else collected the difference.',
      'Working longer is not productivity. That is just a longer day. The chart you want is output per hour, not a sermon about grit.',
      'And that, ladies and gentlemen, is the rub.',
    ],
  },
];
