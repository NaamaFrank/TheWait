/**
 * Waits nobody was there to end.
 *
 * The clock runs whether or not anyone is watching, so a laptop closed
 * mid-wait logs a session of several hours. It is not a wait, and anything
 * derived from its length describes forgetfulness instead of waiting.
 *
 * One definition, used by every screen that reads sessions back: analytics
 * sizes the charts from it, and progress splits a wait's whole duration
 * across the tasks cleared during it - so a six-hour session with one stretch
 * in it reported six hours of stretching.
 *
 * Going forward the Wait screen offers these back before they are ever logged
 * (see `wait.js`); this is for the rows already in the table.
 */

/**
 * Past this, a logged wait is almost certainly one nobody ended.
 *
 * Even a long agent run comes back inside an hour. Generous on purpose: the
 * cost of counting a real wait as abandoned is worse than the reverse.
 */
export const ABANDONED_AFTER_SECONDS = 90 * 60;

export function looksAbandoned(durationSeconds) {
  return durationSeconds > ABANDONED_AFTER_SECONDS;
}
