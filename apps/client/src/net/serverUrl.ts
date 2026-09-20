/**
 * Resolves the game service URL.
 *
 * The client is a static bundle on GitHub Pages, so the server address is
 * baked in at build time. A `?server=` query parameter overrides it, which is
 * what the local and CI playtests use to point at a throwaway server.
 */
export function resolveServerUrl(
  environment: Readonly<Record<string, string | undefined>>,
  search: string
): string | undefined {
  const override = new URLSearchParams(search).get("server");
  if (override !== null && override.length > 0) {
    return normalize(override);
  }

  const configured = environment.VITE_GAME_SERVER_URL;
  if (configured === undefined || configured.length === 0) {
    return undefined;
  }
  return normalize(configured);
}

function normalize(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}
