import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const likedPath = resolve(root, "liked_artists.json");
const seedCachePath = resolve(root, "seed_artist_likes_cache.json");
const outputPath = resolve(root, "data/demo/graph.sample.json");

function artistRef(raw) {
  return {
    id: raw.id,
    username: raw.username || raw.permalink || String(raw.id),
    permalink: raw.permalink || String(raw.id),
    permalinkUrl: raw.permalink_url || raw.permalinkUrl || `https://soundcloud.com/${raw.permalink || raw.id}`,
  };
}

function rank(candidates, seedNames, known) {
  return Array.from(candidates.values())
    .map((entry) => {
      const seedIds = Array.from(entry.seedIds).sort((a, b) => String(seedNames.get(a)).localeCompare(String(seedNames.get(b))));
      return {
        ...entry.artist,
        known,
        rank: 0,
        degree: seedIds.length,
        seedCount: seedIds.length,
        seedIds,
        seedNames: seedIds.map((id) => seedNames.get(id)).filter(Boolean).slice(0, 16),
      };
    })
    .sort((a, b) => b.seedCount - a.seedCount || a.username.localeCompare(b.username))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

if (!existsSync(likedPath) || !existsSync(seedCachePath)) {
  throw new Error("Expected local cache files liked_artists.json and seed_artist_likes_cache.json in the project root.");
}

const likedArtists = JSON.parse(await readFile(likedPath, "utf8")).slice(0, 24).map(artistRef);
const seedCache = JSON.parse(await readFile(seedCachePath, "utf8"));
const knownIds = new Set(likedArtists.map((artist) => artist.id));
const seedNames = new Map(likedArtists.map((artist) => [artist.id, artist.username]));
const discover = new Map();
const known = new Map();
const links = [];

for (const seed of likedArtists.slice(0, 14)) {
  const liked = (seedCache[String(seed.id)] || []).slice(0, 40).map(artistRef);
  for (const artist of liked) {
    if (artist.id === seed.id || seedNames.has(artist.id)) continue;
    const bucket = knownIds.has(artist.id) ? known : discover;
    const existing = bucket.get(artist.id) || { artist, seedIds: new Set() };
    existing.seedIds.add(seed.id);
    bucket.set(artist.id, existing);
  }
}

const discoverRanked = rank(discover, seedNames, false).slice(0, 80);
const knownRanked = rank(known, seedNames, true).slice(0, 40);
const keptIds = new Set([...discoverRanked, ...knownRanked].map((artist) => artist.id));
const connectedSeeds = new Set();

for (const seed of likedArtists.slice(0, 14)) {
  const liked = (seedCache[String(seed.id)] || []).slice(0, 40).map(artistRef);
  for (const artist of liked) {
    if (!keptIds.has(artist.id)) continue;
    links.push({ source: seed.id, target: artist.id });
    connectedSeeds.add(seed.id);
  }
}

const seedNodes = likedArtists
  .filter((seed) => connectedSeeds.has(seed.id))
  .map((seed) => ({
    ...seed,
    kind: "seed",
    category: "seed",
    known: true,
    degree: links.filter((link) => link.source === seed.id).length,
    seedSupport: links.filter((link) => link.source === seed.id).length,
    seedSource: "liked",
    seedNames: ["liked"],
  }));

const rankedNode = (artist, category) => ({
  ...artist,
  kind: "liked",
  category,
  seedSupport: artist.seedCount,
  seedNames: artist.seedNames,
});

const graph = {
  nodes: [
    ...seedNodes,
    ...discoverRanked.slice(0, 80).map((artist) => rankedNode(artist, "discover")),
    ...knownRanked.slice(0, 40).map((artist) => rankedNode(artist, "known")),
  ],
  links,
};

const fixture = {
  profile: {
    id: 0,
    username: "Generated Demo",
    permalink: "generated-demo",
    permalinkUrl: "https://soundcloud.com/generated-demo",
  },
  metrics: {
    seeds: seedNodes.length,
    knownTotal: knownRanked.length,
    discoverTotal: discoverRanked.length,
    renderedNodes: graph.nodes.length,
    renderedEdges: graph.links.length,
    failedSeeds: 0,
  },
  graph,
  rankings: {
    discover: discoverRanked,
    known: knownRanked,
  },
  warnings: [],
  generatedAt: new Date().toISOString(),
};

await writeFile(outputPath, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
