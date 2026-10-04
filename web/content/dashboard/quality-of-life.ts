import type { Section } from '@/content/dashboard/economy';

/**
 * The quality-of-life dashboard: how Australians are living, from the OECD's How's Life? well-being indicators
 * (official, comparable across OECD countries) plus Australian housing measures. Most of these series are annual
 * or less frequent, so each is judged against the OECD median: where Australia sits among comparable countries.
 */
const OECD_MEDIAN = { kind: 'oecd' as const };

export const QOL_SECTIONS: Section[] = [
  {
    id: 'income',
    title: 'Income & wealth',
    question: 'Do households have enough, and how evenly is it shared?',
    headline: {
      metric_id: 'hsl_1_1', label: 'Household disposable income per person (incl. public services)', short: 'Household income',
      why: 'Income after tax and transfers, including the value of public services such as health and education: the OECD\'s main measure of material living standards.',
      benchmark: OECD_MEDIAN, higherIsBetter: true, history: 15, unit: 'usd',
    },
    others: [
      { metric_id: 'hsl_1_4', label: 'People in relative income poverty', short: 'Poverty',
        why: 'The share of people living on less than half the median household income.',
        benchmark: OECD_MEDIAN, higherIsBetter: false, history: 15, unit: 'percent' },
      { metric_id: 'hsl_1_2', label: 'Income inequality: top fifth vs bottom fifth', short: 'Inequality',
        why: 'How many times more the richest fifth of households receive than the poorest fifth.',
        benchmark: OECD_MEDIAN, higherIsBetter: false, history: 15, unit: 'ratio' },
      { metric_id: 'hsl_1_6', label: 'Financially insecure: savings under three months of poverty-line income', short: 'Financial insecurity',
        why: 'People without enough liquid savings to ride out three months without income.',
        benchmark: OECD_MEDIAN, higherIsBetter: false, history: 15, unit: 'percent' },
      { metric_id: 'hsl_1_3', label: 'Median household net wealth', short: 'Median wealth',
        why: 'What the typical household owns, less what it owes; for most Australians this is largely the family home.',
        benchmark: OECD_MEDIAN, higherIsBetter: true, history: 15, unit: 'usd' },
    ],
  },
  {
    id: 'work',
    title: 'Work & earnings',
    question: 'Can people find work, and does it pay and treat them well?',
    headline: {
      metric_id: 'hsl_2_1', label: 'Employment rate, ages 25–64', short: 'Employment rate',
      why: 'The share of working-age adults in a job: a broader measure than unemployment because it counts people who have given up looking.',
      benchmark: OECD_MEDIAN, higherIsBetter: true, history: 15, unit: 'percent',
    },
    others: [
      { metric_id: 'hsl_2_3', label: 'Long-term unemployment rate', short: 'Long-term unemployed',
        why: 'People out of work for a year or more, the group whose skills and prospects suffer most.',
        benchmark: OECD_MEDIAN, higherIsBetter: false, history: 15, unit: 'percent' },
      { metric_id: 'hsl_2_4', label: 'Young people not in work, education or training', short: 'Youth not in work or study',
        why: 'Young people disconnected from both work and study risk lasting harm to earnings and wellbeing.',
        benchmark: OECD_MEDIAN, higherIsBetter: false, history: 15, unit: 'percent' },
      { metric_id: 'hsl_2_2', label: 'Gender wage gap', short: 'Gender pay gap',
        why: 'How far women\'s median full-time earnings fall below men\'s.',
        benchmark: OECD_MEDIAN, higherIsBetter: false, history: 15, unit: 'percent' },
      { metric_id: 'hsl_2_7', label: 'Employees working very long hours (50+ a week)', short: 'Long hours',
        why: 'Long hours crowd out rest, family and health.',
        benchmark: OECD_MEDIAN, higherIsBetter: false, history: 15, unit: 'percent' },
      { metric_id: 'hsl_2_8', label: 'Average annual gross earnings', short: 'Earnings',
        why: 'What full-time equivalent employees earn before tax, converted at purchasing power parity.',
        benchmark: OECD_MEDIAN, higherIsBetter: true, history: 15, unit: 'usd' },
    ],
  },
  {
    id: 'housing',
    title: 'Housing',
    question: 'Can people afford a decent home?',
    headline: {
      metric_id: 'hsl_3_2', label: 'Income left after housing costs', short: 'Housing affordability',
      why: 'The share of household disposable income left once housing costs are paid; the less that is left, the tighter the squeeze on everything else.',
      benchmark: OECD_MEDIAN, higherIsBetter: true, history: 15, unit: 'percent',
    },
    others: [
      { metric_id: 'hsl_3_3', label: 'Housing cost overburden (40%+ of income on housing)', short: 'Overburdened',
        why: 'People in low-income households spending more than 40 per cent of disposable income on housing.',
        benchmark: OECD_MEDIAN, higherIsBetter: false, history: 15, unit: 'percent' },
      { metric_id: 'housing_repayments_income_au', label: 'Scheduled mortgage repayments, share of disposable income', short: 'Mortgage burden',
        why: 'The quarterly Australian measure of how much household income goes to mortgage repayments.',
        benchmark: { kind: 'average', years: 10 }, higherIsBetter: false, history: 40, unit: 'percent' },
      { metric_id: 'rent_cpi_annual_au', label: 'Rents, annual change (CPI)', short: 'Rent growth',
        why: 'How quickly rents are rising for tenants.',
        benchmark: { kind: 'average', years: 10 }, higherIsBetter: false, history: 40, unit: 'percent' },
    ],
  },
  {
    id: 'health',
    title: 'Health',
    question: 'Are Australians living long, healthy lives?',
    headline: {
      metric_id: 'hsl_5_1', label: 'Life expectancy at birth', short: 'Life expectancy',
      why: 'The most widely used summary of a population\'s health.',
      benchmark: OECD_MEDIAN, higherIsBetter: true, history: 15, unit: 'years',
    },
    others: [
      { metric_id: 'hsl_5_2', label: 'People rating their own health as good or very good', short: 'Good health',
        why: 'How people judge their own health, which predicts later health and use of services.',
        benchmark: OECD_MEDIAN, higherIsBetter: true, history: 15, unit: 'percent' },
      { metric_id: 'hsl_5_3', label: 'Deaths from suicide, alcohol and drugs', short: 'Deaths of despair',
        why: 'Deaths linked to distress and addiction, a sensitive signal of social and mental health.',
        benchmark: OECD_MEDIAN, higherIsBetter: false, history: 15, unit: 'per_100k' },
    ],
  },
  {
    id: 'skills',
    title: 'Knowledge & skills',
    question: 'Are young Australians learning what they need?',
    headline: {
      metric_id: 'hsl_6_2', label: 'Student mathematics skills (PISA, age 15)', short: 'Maths',
      why: 'Mathematics at 15 predicts later education, earnings and the economy\'s capacity to grow.',
      benchmark: OECD_MEDIAN, higherIsBetter: true, history: 6, unit: 'points',
    },
    others: [
      { metric_id: 'hsl_6_1', label: 'Student reading skills (PISA, age 15)', short: 'Reading',
        why: 'Reading underpins learning in every subject.',
        benchmark: OECD_MEDIAN, higherIsBetter: true, history: 6, unit: 'points' },
      { metric_id: 'hsl_6_3', label: 'Student science skills (PISA, age 15)', short: 'Science',
        why: 'Scientific literacy at 15.',
        benchmark: OECD_MEDIAN, higherIsBetter: true, history: 6, unit: 'points' },
    ],
  },
  {
    id: 'safety',
    title: 'Safety',
    question: 'Do people feel, and are they, safe?',
    headline: {
      metric_id: 'hsl_10_2', label: 'People who feel safe walking alone at night', short: 'Feeling safe',
      why: 'Feeling safe shapes how freely people move, work and take part in community life.',
      benchmark: OECD_MEDIAN, higherIsBetter: true, history: 15, unit: 'percent',
    },
    others: [
      { metric_id: 'hsl_10_1', label: 'Homicides', short: 'Homicides',
        why: 'The most serious violent crime, and the most reliably recorded.',
        benchmark: OECD_MEDIAN, higherIsBetter: false, history: 15, unit: 'per_100k' },
      { metric_id: 'hsl_10_3', label: 'Road deaths', short: 'Road deaths',
        why: 'Road crashes are a leading cause of preventable death.',
        benchmark: OECD_MEDIAN, higherIsBetter: false, history: 15, unit: 'per_100k' },
    ],
  },
  {
    id: 'wellbeing',
    title: 'Life satisfaction & connection',
    question: 'How do people feel about their lives, and do they have support?',
    headline: {
      metric_id: 'hsl_11_1', label: 'Life satisfaction (0–10)', short: 'Life satisfaction',
      why: 'How people rate their lives overall: the single broadest measure of wellbeing.',
      benchmark: OECD_MEDIAN, higherIsBetter: true, history: 15, unit: 'score',
    },
    others: [
      { metric_id: 'hsl_11_2', label: 'People with more negative than positive feelings', short: 'Negative feelings',
        why: 'The share whose recent days held more worry, sadness or anger than enjoyment.',
        benchmark: OECD_MEDIAN, higherIsBetter: false, history: 15, unit: 'percent' },
      { metric_id: 'hsl_7_1', label: 'People with someone to count on', short: 'Social support',
        why: 'Having friends or relatives to rely on in times of trouble protects against isolation.',
        benchmark: OECD_MEDIAN, higherIsBetter: true, history: 15, unit: 'percent' },
    ],
  },
  {
    id: 'civic',
    title: 'Civic life & environment',
    question: 'Do people have a voice, and a healthy environment to live in?',
    headline: {
      metric_id: 'hsl_8_1', label: 'People who feel they have a say in what government does', short: 'Having a say',
      why: 'Political efficacy: whether people believe government listens to them.',
      benchmark: OECD_MEDIAN, higherIsBetter: true, history: 10, unit: 'percent',
    },
    others: [
      { metric_id: 'hsl_8_2', label: 'Voter turnout', short: 'Voter turnout',
        why: 'Turnout at national elections. Voting is compulsory in Australia, which lifts its figure.',
        benchmark: OECD_MEDIAN, higherIsBetter: true, history: 10, unit: 'percent' },
      { metric_id: 'hsl_9_2', label: 'People exposed to air pollution above WHO guidelines', short: 'Air pollution',
        why: 'Fine-particle pollution above World Health Organization guideline levels harms heart and lung health.',
        benchmark: OECD_MEDIAN, higherIsBetter: false, history: 15, unit: 'percent' },
      { metric_id: 'hsl_9_3', label: 'People exposed to extreme temperatures', short: 'Extreme heat',
        why: 'Exposure to very hot days, a growing health risk as the climate warms.',
        benchmark: OECD_MEDIAN, higherIsBetter: false, history: 15, unit: 'percent' },
    ],
  },
];

export const qolSectionById = (id: string) => QOL_SECTIONS.find((s) => s.id === id);
