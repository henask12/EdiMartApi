/**
 * One setting drives how long a login lasts: SESSION_TTL_HOURS (default 8).
 * The API signs the JWT with it and tells the web app the same number of seconds, so the
 * browser cookie and the token can never disagree.
 */
export const DEFAULT_SESSION_TTL_HOURS = 8;

export const sessionTtlSeconds = (env: NodeJS.ProcessEnv = process.env): number => {
  const raw = env.SESSION_TTL_HOURS?.trim();
  const hours = raw ? Number(raw) : DEFAULT_SESSION_TTL_HOURS;
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 30) {
    throw new Error(`SESSION_TTL_HOURS must be a number of hours between 0 and 720, got "${raw}"`);
  }
  return Math.round(hours * 3600);
};
