/**
 * The newsroom's calendar day. Publish and update dates are Sydney dates: a UTC date is a day behind for most of
 * the Sydney morning (the nightly article job runs at about 3am Sydney, 16:00 UTC the previous day).
 */
export const sydneyDay = (d: Date = new Date()): string => d.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
