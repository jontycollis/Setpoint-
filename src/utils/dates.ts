/** Format a date for display — accepts ISO string or Unix ms timestamp */
export function formatDate(date: string | number): string {
  const d = typeof date === 'number' ? new Date(date) : new Date(date);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Format a datetime for display as time — accepts ISO string or Unix ms */
export function formatTime(date: string | number): string {
  const d = typeof date === 'number' ? new Date(date) : new Date(date);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Format date range for event display */
export function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const startStr = s.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const endStr = e.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${startStr} – ${endStr}`;
}

/** Get relative time description — accepts ISO string or Unix ms */
export function getRelativeTime(date: string | number): string {
  const now = new Date();
  const target = typeof date === 'number' ? new Date(date) : new Date(date);
  const diffMs = target.getTime() - now.getTime();
  const diffMins = Math.round(diffMs / 60000);

  if (diffMins < 0) {
    const absMins = Math.abs(diffMins);
    if (absMins < 60) return `${absMins}m ago`;
    if (absMins < 1440) return `${Math.round(absMins / 60)}h ago`;
    return formatDate(date);
  }

  if (diffMins < 60) return `In ${diffMins}m`;
  if (diffMins < 1440) return `In ${Math.round(diffMins / 60)}h`;
  if (diffMins < 2880) return 'Tomorrow';
  return formatDate(date);
}

/** Format date as YYYY-MM-DD for API calls */
export function toApiDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/** Format a short day label (e.g. "Sun Apr 19") from ISO or Unix ms */
export function formatShortDay(date: string | number): string {
  const d = typeof date === 'number' ? new Date(date) : new Date(date);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
