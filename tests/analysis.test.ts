import { describe, expect, it } from "vitest";
import { buildAnalysisResponse, buildSeedArtists } from "@/lib/analysis";
import type { ArtistRef, SeedLikeResult } from "@/lib/contracts";

function artist(id: number, username = `Artist ${id}`): ArtistRef {
  return {
    id,
    username,
    permalink: username.toLowerCase().replace(/\s+/g, "-"),
    permalinkUrl: `https://soundcloud.com/${username.toLowerCase().replace(/\s+/g, "-")}`,
  };
}

describe("buildSeedArtists", () => {
  it("deduplicates liked and followed seeds and marks source", () => {
    const seeds = buildSeedArtists([artist(1, "Liked A"), artist(2, "Both")], [artist(2, "Both"), artist(3, "Followed C")], 3);

    expect(seeds).toHaveLength(3);
    expect(seeds.find((seed) => seed.id === 2)?.seedSource).toBe("both");
    expect(seeds.find((seed) => seed.id === 1)?.seedSource).toBe("liked");
    expect(seeds.find((seed) => seed.id === 3)?.seedSource).toBe("followed");
  });
});

describe("buildAnalysisResponse", () => {
  it("classifies known and discover artists and ranks by seed support", () => {
    const likedArtists = [artist(1, "Seed One"), artist(2, "Seed Two"), artist(20, "Known Artist")];
    const followedArtists = [artist(3, "Seed Three")];
    const seeds = buildSeedArtists(likedArtists, followedArtists, 3);
    const seedLikeResults: SeedLikeResult[] = [
      { seed: seeds[0], likedArtists: [artist(100, "Shared Discovery"), artist(20, "Known Artist")] },
      { seed: seeds[1], likedArtists: [artist(100, "Shared Discovery"), artist(101, "Solo Discovery")] },
      { seed: seeds[2], likedArtists: [artist(100, "Shared Discovery")] },
    ];

    const response = buildAnalysisResponse({
      profile: artist(999, "Profile"),
      likedArtists,
      followedArtists,
      seedLikeResults,
      maxSeedArtists: 3,
      graphDensity: "focused",
    });

    expect(response.rankings.discover[0]).toMatchObject({
      username: "Shared Discovery",
      seedCount: 3,
      known: false,
    });
    expect(response.rankings.known[0]).toMatchObject({
      username: "Known Artist",
      known: true,
    });
    expect(response.metrics.discoverTotal).toBe(2);
    expect(response.metrics.knownTotal).toBe(1);
  });

  it("keeps graph sampling inside focused edge and node budgets", () => {
    const likedArtists = Array.from({ length: 80 }, (_, index) => artist(index + 1, `Seed ${index + 1}`));
    const seeds = buildSeedArtists(likedArtists, [], 80);
    const seedLikeResults: SeedLikeResult[] = seeds.map((seed, seedIndex) => ({
      seed,
      likedArtists: Array.from({ length: 100 }, (_, likedIndex) => artist(10_000 + seedIndex * 100 + likedIndex)),
    }));

    const response = buildAnalysisResponse({
      profile: artist(999, "Profile"),
      likedArtists,
      followedArtists: [],
      seedLikeResults,
      maxSeedArtists: 80,
      graphDensity: "focused",
    });

    expect(response.graph.links.length).toBeLessThanOrEqual(2800);
    expect(response.graph.nodes.length).toBeLessThanOrEqual(860);
  });
});
