/**
 * The setup endpoints (`GET /setup/status`, `POST /setup/seed`) and AUTO_SEED are only loaded
 * when SETUP_ENABLED is on. Unset means off, except in local development. When off, the routes
 * do not exist at all, so they answer 404.
 */
export const isSetupEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => {
  const value = env.SETUP_ENABLED?.trim().toLowerCase();
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return env.NODE_ENV === "development";
};
