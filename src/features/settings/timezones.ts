/**
 * The timezone list for Settings. V8's `Intl.supportedValuesOf('timeZone')`
 * lists canonical names only, so `Asia/Kolkata`, which the server gives
 * every new user, is missing (V8 lists `Asia/Calcutta`). A <select> whose
 * value matches no option shows the first one, which is how every new user
 * saw "Africa/Abidjan". The user's own zone is therefore always an option.
 */
export function timezoneOptions(current: string | undefined, supported: () => string[] = supportedZones): string[] {
  const list = supported();
  if (current && !list.includes(current)) return [...list, current].sort();
  return list;
}

function supportedZones(): string[] {
  try {
    const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (f) return f('timeZone');
  } catch { /* old browser */ }
  return ['Asia/Kolkata', 'UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'];
}
