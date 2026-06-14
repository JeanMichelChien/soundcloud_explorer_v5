import { describe, expect, it } from "vitest";
import {
  extractArtistsFromFollowings,
  extractArtistsFromLikes,
  parseProfileInput,
} from "@/lib/soundcloud";

describe("parseProfileInput", () => {
  it("normalizes usernames and profile URLs", () => {
    expect(parseProfileInput("@luigi28000")).toBe("luigi28000");
    expect(parseProfileInput("https://soundcloud.com/luigi28000/likes?x=1")).toBe("luigi28000");
    expect(parseProfileInput("soundcloud.com/artist-name")).toBe("artist-name");
  });

  it("rejects non-SoundCloud URLs", () => {
    expect(() => parseProfileInput("https://example.com/luigi28000")).toThrow(/SoundCloud/);
  });
});

describe("SoundCloud collection extraction", () => {
  it("extracts unique artists from liked tracks and playlists", () => {
    const artists = extractArtistsFromLikes([
      {
        track: {
          user: {
            id: 1,
            username: "Artist One",
            permalink: "artist-one",
            permalink_url: "https://soundcloud.com/artist-one",
          },
        },
      },
      {
        playlist: {
          user: {
            id: 1,
            username: "Artist One",
            permalink: "artist-one",
            permalink_url: "https://soundcloud.com/artist-one",
          },
        },
      },
      {
        track: {
          user: {
            id: 2,
            username: "Artist Two",
            permalink: "artist-two",
            permalink_url: "https://soundcloud.com/artist-two",
          },
        },
      },
    ]);

    expect(artists).toHaveLength(2);
    expect(artists.map((artist) => artist.username)).toEqual(["Artist One", "Artist Two"]);
  });

  it("extracts artists from followings collections", () => {
    const artists = extractArtistsFromFollowings([
      {
        id: 3,
        username: "Followed Artist",
        permalink: "followed-artist",
        permalink_url: "https://soundcloud.com/followed-artist",
      },
      {
        user: {
          id: 4,
          username: "Nested Artist",
          permalink: "nested-artist",
          permalink_url: "https://soundcloud.com/nested-artist",
        },
      },
    ]);

    expect(artists.map((artist) => artist.id)).toEqual([3, 4]);
  });
});
