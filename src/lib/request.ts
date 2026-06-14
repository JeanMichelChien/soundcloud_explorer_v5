import type { AnalyzeRequest, GraphDensity } from "./contracts";

export const ANALYZE_LIMITS = {
  defaultMaxSeedArtists: 40,
  maxSeedArtists: 80,
  defaultLikesPerSeed: 50,
  maxLikesPerSeed: 100,
  defaultGraphDensity: "focused",
} as const;

export interface ValidatedAnalyzeRequest {
  profile: string;
  maxSeedArtists: number;
  likesPerSeed: number;
  graphDensity: GraphDensity;
}

function clampPositiveInteger(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(Math.floor(numeric), 1), max);
}

export function validateAnalyzeRequest(body: unknown): ValidatedAnalyzeRequest {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be a JSON object.");
  }

  const request = body as AnalyzeRequest;
  const profile = typeof request.profile === "string" ? request.profile.trim() : "";
  if (!profile) {
    throw new Error("Profile is required.");
  }

  const graphDensity: GraphDensity =
    request.graphDensity === "expanded" || request.graphDensity === "focused"
      ? request.graphDensity
      : ANALYZE_LIMITS.defaultGraphDensity;

  return {
    profile,
    maxSeedArtists: clampPositiveInteger(
      request.maxSeedArtists,
      ANALYZE_LIMITS.defaultMaxSeedArtists,
      ANALYZE_LIMITS.maxSeedArtists,
    ),
    likesPerSeed: clampPositiveInteger(
      request.likesPerSeed,
      ANALYZE_LIMITS.defaultLikesPerSeed,
      ANALYZE_LIMITS.maxLikesPerSeed,
    ),
    graphDensity,
  };
}
