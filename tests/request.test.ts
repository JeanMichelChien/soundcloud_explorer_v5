import { describe, expect, it } from "vitest";
import { validateAnalyzeRequest } from "@/lib/request";

describe("validateAnalyzeRequest", () => {
  it("applies defaults and caps expensive inputs", () => {
    expect(validateAnalyzeRequest({ profile: "demo" })).toMatchObject({
      profile: "demo",
      maxSeedArtists: 40,
      likesPerSeed: 50,
      graphDensity: "focused",
    });

    expect(
      validateAnalyzeRequest({
        profile: "demo",
        maxSeedArtists: 999,
        likesPerSeed: 999,
        graphDensity: "expanded",
      }),
    ).toMatchObject({
      maxSeedArtists: 80,
      likesPerSeed: 100,
      graphDensity: "expanded",
    });
  });

  it("rejects missing profile values", () => {
    expect(() => validateAnalyzeRequest({ profile: "" })).toThrow(/Profile/);
    expect(() => validateAnalyzeRequest(null)).toThrow(/JSON object/);
  });
});
