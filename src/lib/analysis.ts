import type {
  AnalyzeResponse,
  ArtistRef,
  GraphDensity,
  GraphLink,
  GraphNode,
  RankedArtist,
  SeedArtist,
  SeedLikeResult,
  SeedSource,
} from "./contracts";

const RESULT_LIMITS = {
  rankedDiscover: 800,
  rankedKnown: 400,
  supportNames: 16,
};

const GRAPH_LIMITS: Record<
  GraphDensity,
  {
    discover: number;
    known: number;
    maxEdges: number;
  }
> = {
  focused: {
    discover: 560,
    known: 220,
    maxEdges: 2_800,
  },
  expanded: {
    discover: 780,
    known: 320,
    maxEdges: 5_000,
  },
};

interface SeedCandidate {
  artist: ArtistRef;
  known: boolean;
  supporterIds: Set<number>;
}

interface BuildAnalysisInput {
  profile: ArtistRef;
  likedArtists: ArtistRef[];
  followedArtists: ArtistRef[];
  seedLikeResults: SeedLikeResult[];
  maxSeedArtists: number;
  graphDensity: GraphDensity;
  warnings?: string[];
}

function mergeSeedSource(current: SeedSource, next: SeedSource): SeedSource {
  if (current === next) return current;
  return "both";
}

function byName(a: ArtistRef, b: ArtistRef): number {
  return a.username.localeCompare(b.username, undefined, { sensitivity: "base" });
}

function sourceLabel(source: SeedSource): string {
  if (source === "both") return "liked and followed";
  return source;
}

export function buildSeedArtists(
  likedArtists: ArtistRef[],
  followedArtists: ArtistRef[],
  maxSeedArtists: number,
): SeedArtist[] {
  const merged = new Map<number, SeedArtist>();
  const likedOnly: SeedArtist[] = [];
  const followedOnly: SeedArtist[] = [];
  const both: SeedArtist[] = [];

  for (const artist of likedArtists) {
    if (!merged.has(artist.id)) {
      merged.set(artist.id, { ...artist, seedSource: "liked" });
    }
  }

  for (const artist of followedArtists) {
    const existing = merged.get(artist.id);
    if (existing) {
      existing.seedSource = mergeSeedSource(existing.seedSource, "followed");
    } else {
      merged.set(artist.id, { ...artist, seedSource: "followed" });
    }
  }

  for (const seed of merged.values()) {
    if (seed.seedSource === "both") both.push(seed);
    else if (seed.seedSource === "liked") likedOnly.push(seed);
    else followedOnly.push(seed);
  }

  const selected = [...both.sort(byName)];
  let likedIndex = 0;
  let followedIndex = 0;

  while (selected.length < maxSeedArtists && (likedIndex < likedOnly.length || followedIndex < followedOnly.length)) {
    if (likedIndex < likedOnly.length) selected.push(likedOnly[likedIndex++]);
    if (selected.length >= maxSeedArtists) break;
    if (followedIndex < followedOnly.length) selected.push(followedOnly[followedIndex++]);
  }

  return selected.slice(0, maxSeedArtists);
}

function buildKnownIds(likedArtists: ArtistRef[], followedArtists: ArtistRef[]): Set<number> {
  return new Set([...likedArtists, ...followedArtists].map((artist) => artist.id));
}

function rankCandidates(candidates: SeedCandidate[], seedById: Map<number, SeedArtist>): RankedArtist[] {
  return candidates
    .map((candidate) => {
      const seedIds = Array.from(candidate.supporterIds).sort((a, b) => {
        const seedA = seedById.get(a);
        const seedB = seedById.get(b);
        return (seedA?.username || String(a)).localeCompare(seedB?.username || String(b), undefined, {
          sensitivity: "base",
        });
      });
      return {
        ...candidate.artist,
        known: candidate.known,
        rank: 0,
        degree: seedIds.length,
        seedCount: seedIds.length,
        seedIds,
        seedNames: seedIds
          .map((id) => seedById.get(id)?.username)
          .filter((name): name is string => Boolean(name))
          .slice(0, RESULT_LIMITS.supportNames),
      };
    })
    .sort((a, b) => {
      if (b.seedCount !== a.seedCount) return b.seedCount - a.seedCount;
      if (b.degree !== a.degree) return b.degree - a.degree;
      return a.username.localeCompare(b.username, undefined, { sensitivity: "base" });
    })
    .map((artist, index) => ({ ...artist, rank: index + 1 }));
}

function createGraphNodeFromRanked(artist: RankedArtist, category: "known" | "discover"): GraphNode {
  return {
    id: artist.id,
    username: artist.username,
    permalink: artist.permalink,
    permalinkUrl: artist.permalinkUrl,
    avatarUrl: artist.avatarUrl,
    followersCount: artist.followersCount,
    trackCount: artist.trackCount,
    city: artist.city,
    kind: "liked",
    category,
    known: artist.known,
    degree: artist.degree,
    seedSupport: artist.seedCount,
    seedNames: artist.seedNames,
    rank: artist.rank,
  };
}

function sampleGraph(
  seedLikeResults: SeedLikeResult[],
  seedById: Map<number, SeedArtist>,
  discoverRanked: RankedArtist[],
  knownRanked: RankedArtist[],
  graphDensity: GraphDensity,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const limits = GRAPH_LIMITS[graphDensity];
  const keptDiscover = discoverRanked.slice(0, limits.discover);
  const keptKnown = knownRanked.slice(0, limits.known);
  const keptLikedIds = new Set([...keptDiscover, ...keptKnown].map((artist) => artist.id));
  const rankedById = new Map<number, RankedArtist>();
  for (const artist of [...keptDiscover, ...keptKnown]) rankedById.set(artist.id, artist);

  const links: GraphLink[] = [];
  const linkKeys = new Set<string>();
  const connectedSeedIds = new Set<number>();
  const candidateDegree = new Map<number, number>();
  const seedDegree = new Map<number, number>();

  for (const result of seedLikeResults) {
    if (result.error) continue;
    const seedId = result.seed.id;
    if (!seedById.has(seedId)) continue;

    for (const likedArtist of result.likedArtists) {
      if (!keptLikedIds.has(likedArtist.id)) continue;
      const key = `${seedId}:${likedArtist.id}`;
      if (linkKeys.has(key)) continue;
      if (links.length >= limits.maxEdges) break;

      linkKeys.add(key);
      links.push({ source: seedId, target: likedArtist.id });
      connectedSeedIds.add(seedId);
      candidateDegree.set(likedArtist.id, (candidateDegree.get(likedArtist.id) || 0) + 1);
      seedDegree.set(seedId, (seedDegree.get(seedId) || 0) + 1);
    }
  }

  const nodes: GraphNode[] = [];
  for (const seedId of connectedSeedIds) {
    const seed = seedById.get(seedId);
    if (!seed) continue;
    nodes.push({
      id: seed.id,
      username: seed.username,
      permalink: seed.permalink,
      permalinkUrl: seed.permalinkUrl,
      avatarUrl: seed.avatarUrl,
      followersCount: seed.followersCount,
      trackCount: seed.trackCount,
      city: seed.city,
      kind: "seed",
      category: "seed",
      known: true,
      degree: seedDegree.get(seed.id) || 0,
      seedSupport: seedDegree.get(seed.id) || 0,
      seedSource: seed.seedSource,
      seedNames: [sourceLabel(seed.seedSource)],
    });
  }

  for (const artist of keptDiscover) {
    if (!candidateDegree.has(artist.id)) continue;
    nodes.push({
      ...createGraphNodeFromRanked(artist, "discover"),
      degree: candidateDegree.get(artist.id) || artist.degree,
      seedSupport: candidateDegree.get(artist.id) || artist.seedCount,
    });
  }

  for (const artist of keptKnown) {
    if (!candidateDegree.has(artist.id)) continue;
    nodes.push({
      ...createGraphNodeFromRanked(artist, "known"),
      degree: candidateDegree.get(artist.id) || artist.degree,
      seedSupport: candidateDegree.get(artist.id) || artist.seedCount,
    });
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    links: links.filter((link) => nodeIds.has(link.source) && nodeIds.has(link.target)),
  };
}

export function buildAnalysisResponse(input: BuildAnalysisInput): AnalyzeResponse {
  const selectedSeeds = buildSeedArtists(input.likedArtists, input.followedArtists, input.maxSeedArtists);
  const seedById = new Map(selectedSeeds.map((seed) => [seed.id, seed]));
  const knownIds = buildKnownIds(input.likedArtists, input.followedArtists);
  const seedIds = new Set(selectedSeeds.map((seed) => seed.id));
  const candidates = new Map<number, SeedCandidate>();
  const failedSeeds = input.seedLikeResults.filter((result) => result.error).length;

  for (const result of input.seedLikeResults) {
    if (result.error || !seedById.has(result.seed.id)) continue;

    for (const likedArtist of result.likedArtists) {
      if (seedIds.has(likedArtist.id)) continue;
      const known = knownIds.has(likedArtist.id);
      const existing = candidates.get(likedArtist.id);
      if (existing) {
        existing.supporterIds.add(result.seed.id);
      } else {
        candidates.set(likedArtist.id, {
          artist: likedArtist,
          known,
          supporterIds: new Set([result.seed.id]),
        });
      }
    }
  }

  const discoverCandidates: SeedCandidate[] = [];
  const knownCandidates: SeedCandidate[] = [];
  for (const candidate of candidates.values()) {
    if (candidate.known) knownCandidates.push(candidate);
    else discoverCandidates.push(candidate);
  }

  const discoverFull = rankCandidates(discoverCandidates, seedById);
  const knownFull = rankCandidates(knownCandidates, seedById);
  const discover = discoverFull.slice(0, RESULT_LIMITS.rankedDiscover);
  const known = knownFull.slice(0, RESULT_LIMITS.rankedKnown);
  const graph = sampleGraph(input.seedLikeResults, seedById, discoverFull, knownFull, input.graphDensity);

  return {
    profile: input.profile,
    metrics: {
      seeds: selectedSeeds.length,
      knownTotal: knownFull.length,
      discoverTotal: discoverFull.length,
      renderedNodes: graph.nodes.length,
      renderedEdges: graph.links.length,
      failedSeeds,
    },
    graph,
    rankings: {
      discover,
      known,
    },
    warnings: input.warnings || [],
    generatedAt: new Date().toISOString(),
  };
}
