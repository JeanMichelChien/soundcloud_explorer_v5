import { NextResponse } from "next/server";
import { buildAnalysisResponse, buildSeedArtists } from "@/lib/analysis";
import type { ArtistRef, SeedArtist, SeedLikeResult } from "@/lib/contracts";
import { validateAnalyzeRequest } from "@/lib/request";
import {
  extractArtistsFromFollowings,
  extractArtistsFromLikes,
  fetchFollowings,
  fetchLikes,
  getClientId,
  resolveUser,
} from "@/lib/soundcloud";

export const runtime = "nodejs";
export const maxDuration = 300;

const SEED_FETCH_CONCURRENCY = 5;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchTargetCollections(
  profile: ArtistRef,
  clientId: string,
  collectionLimit: number,
): Promise<{ likedArtists: ArtistRef[]; followedArtists: ArtistRef[]; warnings: string[] }> {
  const warnings: string[] = [];
  const [likesResult, followingsResult] = await Promise.allSettled([
    fetchLikes(profile.id, clientId, collectionLimit),
    fetchFollowings(profile.id, clientId, collectionLimit),
  ]);

  let likedArtists: ArtistRef[] = [];
  let followedArtists: ArtistRef[] = [];

  if (likesResult.status === "fulfilled") {
    likedArtists = extractArtistsFromLikes(likesResult.value);
  } else {
    warnings.push(`Could not fetch liked artists: ${errorMessage(likesResult.reason)}`);
  }

  if (followingsResult.status === "fulfilled") {
    followedArtists = extractArtistsFromFollowings(followingsResult.value);
  } else {
    warnings.push(`Could not fetch followed artists: ${errorMessage(followingsResult.reason)}`);
  }

  return { likedArtists, followedArtists, warnings };
}

async function fetchSeedLikeResults(
  seeds: SeedArtist[],
  clientId: string,
  likesPerSeed: number,
): Promise<{ seedLikeResults: SeedLikeResult[]; warnings: string[] }> {
  const warnings: string[] = [];
  const seedLikeResults: SeedLikeResult[] = [];

  for (let index = 0; index < seeds.length; index += SEED_FETCH_CONCURRENCY) {
    const batch = seeds.slice(index, index + SEED_FETCH_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (seed) => {
        const likes = await fetchLikes(seed.id, clientId, likesPerSeed);
        return {
          seed,
          likedArtists: extractArtistsFromLikes(likes),
        } satisfies SeedLikeResult;
      }),
    );

    settled.forEach((result, batchIndex) => {
      const seed = batch[batchIndex];
      if (result.status === "fulfilled") {
        seedLikeResults.push(result.value);
      } else {
        const message = `Could not fetch seed "${seed.username}": ${errorMessage(result.reason)}`;
        warnings.push(message);
        seedLikeResults.push({ seed, likedArtists: [], error: message });
      }
    });
  }

  return { seedLikeResults, warnings };
}

export async function POST(request: Request) {
  try {
    const validated = validateAnalyzeRequest(await request.json());
    const clientId = await getClientId();
    const profile = await resolveUser(validated.profile, clientId);
    const collectionLimit = Math.min(Math.max(validated.maxSeedArtists * 4, 200), 500);

    const target = await fetchTargetCollections(profile, clientId, collectionLimit);
    if (!target.likedArtists.length && !target.followedArtists.length) {
      return NextResponse.json(
        {
          error: "No liked or followed artists could be fetched for this profile.",
          warnings: target.warnings,
        },
        { status: 422 },
      );
    }

    const seeds = buildSeedArtists(target.likedArtists, target.followedArtists, validated.maxSeedArtists);
    if (!seeds.length) {
      return NextResponse.json(
        {
          error: "No seed artists were available for this profile.",
          warnings: target.warnings,
        },
        { status: 422 },
      );
    }

    const secondDegree = await fetchSeedLikeResults(seeds, clientId, validated.likesPerSeed);
    const successfulSecondDegreeCount = secondDegree.seedLikeResults.reduce(
      (count, result) => count + (result.error ? 0 : result.likedArtists.length),
      0,
    );

    if (!successfulSecondDegreeCount) {
      return NextResponse.json(
        {
          error: "Could not fetch second-degree likes for the selected seed artists.",
          warnings: [...target.warnings, ...secondDegree.warnings],
        },
        { status: 502 },
      );
    }

    const response = buildAnalysisResponse({
      profile,
      likedArtists: target.likedArtists,
      followedArtists: target.followedArtists,
      seedLikeResults: secondDegree.seedLikeResults,
      maxSeedArtists: validated.maxSeedArtists,
      graphDensity: validated.graphDensity,
      warnings: [...target.warnings, ...secondDegree.warnings],
    });

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
