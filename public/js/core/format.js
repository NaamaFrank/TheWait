/** Presentation-only helpers. Kept pure so screens never re-implement them. */

/** `HH:MM:SS`, or `MM:SS` under an hour - the running timer face. */
export function clockFace(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const pad = (value) => String(value).padStart(2, '0');

  return hours ? `${hours}:${pad(minutes)}:${pad(seconds % 60)}` : `${pad(minutes)}:${pad(seconds % 60)}`;
}

/** Compact human duration: `4s`, `2m 14s`, `1h 42m`. */
export function humanDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));

  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Coarser form for headline metrics, where seconds are noise. */
export function headlineDuration(totalSeconds) {
  const minutes = Math.round(Math.max(0, totalSeconds) / 60);

  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function relativeTime(isoDate) {
  const date = new Date(isoDate);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const startOfDay = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const dayDelta = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (dayDelta === 0) return `Today, ${time}`;
  if (dayDelta === 1) return `Yesterday, ${time}`;
  if (dayDelta < 7) return `${date.toLocaleDateString([], { weekday: 'long' })}, ${time}`;

  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

/** `14` -> `2 PM`, for the hourly trend axis. */
export function hourLabel(hour) {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display} ${suffix}`;
}

export function formatCount(value) {
  return new Intl.NumberFormat().format(Math.round(value));
}
