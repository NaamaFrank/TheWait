/**
 * Local-time bucketing.
 *
 * The server has no idea what timezone a device is in, so the client sends its
 * `Date#getTimezoneOffset()` and everything is shifted into that frame first.
 * "Today" and "2 PM" then mean what the user's own clock says rather than UTC.
 *
 * The shifted `Date` is only ever read through its UTC getters - it is a frame
 * for arithmetic, not a real instant.
 */

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function toLocal(isoDate, tzOffsetMinutes) {
  return new Date(new Date(isoDate).getTime() - tzOffsetMinutes * 60 * 1000);
}

/** `YYYY-MM-DD` in the shifted frame. */
export function localDayKey(date) {
  return date.toISOString().slice(0, 10);
}

/** Epoch ms of the start of the local day containing `date`, in the shifted frame. */
export function localDayStart(date) {
  return Date.parse(`${localDayKey(date)}T00:00:00Z`);
}

/** Single-letter weekday label for a shifted-frame timestamp. */
export function weekdayInitial(dayStartMs) {
  return new Date(dayStartMs).toLocaleDateString('en-US', { weekday: 'narrow', timeZone: 'UTC' });
}

/** Short weekday label (`Mon`) for a shifted-frame timestamp. */
export function weekdayShort(dayStartMs) {
  return new Date(dayStartMs).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}
