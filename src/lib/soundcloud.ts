import type { ArtistRef } from "./contracts";

type UnknownRecord = Record<string, unknown>;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const DEFAULT_TIMEOUT_MS = 15_000;
let cachedClientId: string | null = null;

const soundCloudHeaders = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? (value as UnknownRecord) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
      headers: {
        ...soundCloudHeaders,
        ...(init.headers || {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(input: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  const response = await fetchWithTimeout(input, {}, timeoutMs);
  if (!response.ok) {
    throw new Error(`SoundCloud request failed with status ${response.status}.`);
  }
  return response.json();
}

export function parseProfileInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Profile is required.");
  }

  let candidate = trimmed.replace(/^@/, "");
  if (/^https?:\/\//i.test(candidate)) {
    const url = new URL(candidate);
    if (!/(^|\.)soundcloud\.com$/i.test(url.hostname)) {
      throw new Error("Enter a SoundCloud profile URL or username.");
    }
    candidate = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] || "");
  } else if (candidate.includes("soundcloud.com/")) {
    candidate = parseProfileInput(`https://${candidate}`);
  }

  candidate = candidate.split("?")[0].split("#")[0].replace(/^@/, "").trim();
  if (!candidate || candidate.includes("/") || /\s/.test(candidate) || candidate.length > 90) {
    throw new Error("Enter a valid SoundCloud username or profile URL.");
  }
  return candidate;
}

export function artistFromSoundCloudUser(userValue: unknown): ArtistRef | null {
  const user = asRecord(userValue);
  if (!user) return null;
  const id = asNumber(user.id);
  if (id === undefined) return null;

  const permalink = asString(user.permalink) || String(id);
  const username = asString(user.username) || permalink;
  return {
    id,
    username,
    permalink,
    permalinkUrl: asString(user.permalink_url) || `https://soundcloud.com/${permalink}`,
    avatarUrl: asString(user.avatar_url),
    followersCount: asNumber(user.followers_count),
    trackCount: asNumber(user.track_count),
    city: asString(user.city),
  };
}

export function extractArtistsFromLikes(likes: unknown[]): ArtistRef[] {
  const artists = new Map<number, ArtistRef>();

  for (const entryValue of likes) {
    const entry = asRecord(entryValue);
    if (!entry) continue;
    const track = asRecord(entry.track) || asRecord(entry.playlist) || entry;
    const artist = artistFromSoundCloudUser(track.user);
    if (artist && !artists.has(artist.id)) {
      artists.set(artist.id, artist);
    }
  }

  return Array.from(artists.values());
}

export function extractArtistsFromFollowings(followings: unknown[]): ArtistRef[] {
  const artists = new Map<number, ArtistRef>();

  for (const entryValue of followings) {
    const entry = asRecord(entryValue);
    const artist = artistFromSoundCloudUser(asRecord(entry?.user) || entry);
    if (artist && !artists.has(artist.id)) {
      artists.set(artist.id, artist);
    }
  }

  return Array.from(artists.values());
}

function extractHydrationUser(html: string): ArtistRef | null {
  const match = html.match(/window\.__sc_hydration\s*=\s*(\[.*?\])\s*;/s);
  if (!match) return null;

  try {
    const hydration = JSON.parse(match[1]) as unknown;
    if (!Array.isArray(hydration)) return null;
    for (const itemValue of hydration) {
      const item = asRecord(itemValue);
      if (item?.hydratable !== "user") continue;
      return artistFromSoundCloudUser(item.data);
    }
  } catch {
    return null;
  }

  return null;
}

export async function getClientId(): Promise<string> {
  if (cachedClientId) return cachedClientId;

  const home = await fetchWithTimeout("https://soundcloud.com/");
  if (!home.ok) {
    throw new Error("Could not load SoundCloud homepage.");
  }
  const html = await home.text();

  const scriptUrls = new Set<string>();
  for (const match of html.matchAll(/<script[^>]+src="(https?:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)) {
    scriptUrls.add(match[1]);
  }
  for (const match of html.matchAll(/<script[^>]+src="(\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)) {
    scriptUrls.add(`https:${match[1]}`);
  }

  const patterns = [
    /client_id:"([a-zA-Z0-9]{20,})"/,
    /"client_id":"([a-zA-Z0-9]{20,})"/,
    /client_id=([a-zA-Z0-9]{20,})/,
  ];

  for (const scriptUrl of scriptUrls) {
    const response = await fetchWithTimeout(scriptUrl);
    if (!response.ok) continue;
    const js = await response.text();
    for (const pattern of patterns) {
      const match = js.match(pattern);
      if (match?.[1]) {
        cachedClientId = match[1];
        return cachedClientId;
      }
    }
  }

  throw new Error("Could not find a SoundCloud client_id.");
}

export async function resolveUser(profileInput: string, clientId: string): Promise<ArtistRef> {
  const profile = parseProfileInput(profileInput);
  const url = new URL("https://api-v2.soundcloud.com/resolve");
  url.searchParams.set("url", `https://soundcloud.com/${profile}`);
  url.searchParams.set("client_id", clientId);

  try {
    const resolved = await fetchJson(url.toString());
    const artist = artistFromSoundCloudUser(resolved);
    if (artist) return artist;
  } catch {
    // Fall through to hydration fallback below.
  }

  const htmlResponse = await fetchWithTimeout(`https://soundcloud.com/${profile}/likes`);
  if (!htmlResponse.ok) {
    throw new Error(`Could not resolve SoundCloud profile "${profile}".`);
  }
  const hydrated = extractHydrationUser(await htmlResponse.text());
  if (!hydrated) {
    throw new Error(`Could not resolve SoundCloud profile "${profile}".`);
  }
  return hydrated;
}

async function fetchCollection(endpoint: string, clientId: string, totalLimit: number): Promise<unknown[]> {
  const results: unknown[] = [];
  let nextHref: string | null = endpoint;

  while (nextHref && results.length < totalLimit) {
    const url = new URL(nextHref);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("limit", String(Math.min(200, totalLimit - results.length)));
    url.searchParams.set("linked_partitioning", "1");

    const data = asRecord(await fetchJson(url.toString()));
    const collection = Array.isArray(data?.collection) ? data.collection : [];
    results.push(...collection);

    const next = asString(data?.next_href);
    nextHref = next || null;
  }

  return results.slice(0, totalLimit);
}

export async function fetchLikes(userId: number, clientId: string, totalLimit: number): Promise<unknown[]> {
  return fetchCollection(`https://api-v2.soundcloud.com/users/${userId}/likes`, clientId, totalLimit);
}

export async function fetchFollowings(userId: number, clientId: string, totalLimit: number): Promise<unknown[]> {
  return fetchCollection(`https://api-v2.soundcloud.com/users/${userId}/followings`, clientId, totalLimit);
}
