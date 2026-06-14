export type SeedSource = "liked" | "followed" | "both";
export type GraphDensity = "focused" | "expanded";
export type ArtistCategory = "seed" | "known" | "discover";

export interface ArtistRef {
  id: number;
  username: string;
  permalink: string;
  permalinkUrl: string;
  avatarUrl?: string;
  followersCount?: number;
  trackCount?: number;
  city?: string;
}

export interface SeedArtist extends ArtistRef {
  seedSource: SeedSource;
}

export interface GraphNode extends ArtistRef {
  kind: "seed" | "liked";
  category: ArtistCategory;
  known: boolean;
  degree: number;
  seedSupport: number;
  seedSource?: SeedSource;
  seedNames: string[];
  rank?: number;
}

export interface GraphLink {
  source: number;
  target: number;
}

export interface RankedArtist extends ArtistRef {
  known: boolean;
  rank: number;
  degree: number;
  seedCount: number;
  seedIds: number[];
  seedNames: string[];
}

export interface AnalyzeRequest {
  profile: string;
  maxSeedArtists?: number;
  likesPerSeed?: number;
  graphDensity?: GraphDensity;
}

export interface AnalyzeResponse {
  profile: ArtistRef;
  metrics: {
    seeds: number;
    knownTotal: number;
    discoverTotal: number;
    renderedNodes: number;
    renderedEdges: number;
    failedSeeds: number;
  };
  graph: {
    nodes: GraphNode[];
    links: GraphLink[];
  };
  rankings: {
    discover: RankedArtist[];
    known: RankedArtist[];
  };
  warnings: string[];
  generatedAt: string;
}

export interface SeedLikeResult {
  seed: SeedArtist;
  likedArtists: ArtistRef[];
  error?: string;
}
