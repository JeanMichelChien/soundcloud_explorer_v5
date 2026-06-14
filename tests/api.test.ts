import { beforeEach, describe, expect, it, vi } from "vitest";

const CLIENT_ID = "abcdefghijklmnopqrstuvwxyz";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html" },
  });
}

function user(id: number, username: string) {
  const permalink = username.toLowerCase().replace(/\s+/g, "-");
  return {
    id,
    username,
    permalink,
    permalink_url: `https://soundcloud.com/${permalink}`,
  };
}

function likeFor(userValue: ReturnType<typeof user>) {
  return { track: { user: userValue } };
}

function installFetchMock(options: { failSeedId?: number; resolveFails?: boolean } = {}) {
  global.fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);

    if (url === "https://soundcloud.com/") {
      return htmlResponse('<script src="https://a-v2.sndcdn.com/assets/app.js"></script>');
    }
    if (url === "https://a-v2.sndcdn.com/assets/app.js") {
      return new Response(`window.__x={client_id:"${CLIENT_ID}"}`);
    }
    if (url.startsWith("https://api-v2.soundcloud.com/resolve")) {
      if (options.resolveFails) return jsonResponse({ error: "nope" }, 404);
      return jsonResponse(user(1, "Target Profile"));
    }
    if (url.startsWith("https://soundcloud.com/test-profile/likes")) {
      return htmlResponse("", 404);
    }
    if (url.startsWith("https://api-v2.soundcloud.com/users/1/likes")) {
      return jsonResponse({
        collection: [likeFor(user(10, "Seed One")), likeFor(user(11, "Seed Two"))],
      });
    }
    if (url.startsWith("https://api-v2.soundcloud.com/users/1/followings")) {
      return jsonResponse({
        collection: [user(12, "Seed Three")],
      });
    }
    if (url.startsWith("https://api-v2.soundcloud.com/users/10/likes")) {
      return jsonResponse({
        collection: [likeFor(user(100, "Shared Discovery")), likeFor(user(200, "Known Followed"))],
      });
    }
    if (url.startsWith("https://api-v2.soundcloud.com/users/11/likes")) {
      if (options.failSeedId === 11) return jsonResponse({ error: "seed failed" }, 500);
      return jsonResponse({
        collection: [likeFor(user(100, "Shared Discovery")), likeFor(user(201, "Second Discovery"))],
      });
    }
    if (url.startsWith("https://api-v2.soundcloud.com/users/12/likes")) {
      return jsonResponse({
        collection: [likeFor(user(100, "Shared Discovery")), likeFor(user(10, "Seed One"))],
      });
    }

    return jsonResponse({ error: `Unhandled URL ${url}` }, 500);
  }) as typeof fetch;
}

describe("POST /api/analyze", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns graph data for a successful mocked SoundCloud analysis", async () => {
    installFetchMock();
    const { POST } = await import("@/app/api/analyze/route");
    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        body: JSON.stringify({ profile: "test-profile", maxSeedArtists: 3, likesPerSeed: 10 }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.metrics.seeds).toBe(3);
    expect(payload.rankings.discover[0]).toMatchObject({
      username: "Shared Discovery",
      seedCount: 3,
    });
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(4_500_000);
  });

  it("keeps successful results when one seed fails", async () => {
    installFetchMock({ failSeedId: 11 });
    const { POST } = await import("@/app/api/analyze/route");
    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        body: JSON.stringify({ profile: "test-profile", maxSeedArtists: 3, likesPerSeed: 10 }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.metrics.failedSeeds).toBe(1);
    expect(payload.warnings[0]).toContain("Seed Two");
  });

  it("returns an error when the profile cannot be resolved", async () => {
    installFetchMock({ resolveFails: true });
    const { POST } = await import("@/app/api/analyze/route");
    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        body: JSON.stringify({ profile: "test-profile" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain("Could not resolve");
  });
});
