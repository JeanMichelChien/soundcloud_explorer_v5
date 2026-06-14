"use client";

import dynamic from "next/dynamic";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  GitBranch,
  Info,
  Loader2,
  Radio,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Target,
  Users,
  X,
} from "lucide-react";
import type { AnalyzeResponse, ArtistCategory, GraphNode, RankedArtist } from "@/lib/contracts";

const NetworkGraph = dynamic(() => import("@/components/NetworkGraph"), {
  ssr: false,
  loading: () => <div className="empty-state">Loading graph...</div>,
});

type RankingTab = "discover" | "known";
type GraphFilter = "all" | "discover" | "known";

type TooltipPosition = {
  top: number;
  left: number;
  align: "left" | "center" | "right";
  placement: "top" | "bottom";
};

function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  const updatePosition = useCallback((measuredSize?: { width: number; height: number }) => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;

    const gutter = 12;
    const fallbackWidth = Math.min(300, window.innerWidth - gutter * 2);
    const width = measuredSize?.width || fallbackWidth;
    const height = measuredSize?.height || 96;
    const center = rect.left + rect.width / 2;
    let left = center;
    let align: TooltipPosition["align"] = "center";

    if (center - width / 2 < gutter) {
      left = gutter;
      align = "left";
    } else if (center + width / 2 > window.innerWidth - gutter) {
      left = window.innerWidth - gutter;
      align = "right";
    }

    const bottomTop = rect.bottom + 8;
    const hasRoomBelow = bottomTop + height <= window.innerHeight - gutter;
    const hasRoomAbove = rect.top - height - 8 >= gutter;
    const placement = hasRoomBelow || !hasRoomAbove ? "bottom" : "top";
    const top = placement === "bottom" ? bottomTop : rect.top - 8;

    setPosition({ top: Math.max(gutter, top), left, align, placement });
  }, []);

  const show = useCallback(() => {
    updatePosition();
    setOpen(true);
  }, [updatePosition]);

  useEffect(() => {
    if (!open) return undefined;

    const updateMeasuredPosition = () => {
      const bubble = bubbleRef.current;
      updatePosition(
        bubble
          ? {
              width: bubble.offsetWidth,
              height: bubble.offsetHeight,
            }
          : undefined,
      );
    };

    updateMeasuredPosition();
    window.addEventListener("resize", updateMeasuredPosition);
    window.addEventListener("scroll", updateMeasuredPosition, true);

    return () => {
      window.removeEventListener("resize", updateMeasuredPosition);
      window.removeEventListener("scroll", updateMeasuredPosition, true);
    };
  }, [open, updatePosition]);

  return (
    <span className="info-tip" onMouseLeave={() => setOpen(false)}>
      <button
        ref={buttonRef}
        className="info-button"
        type="button"
        aria-label={`About ${label}`}
        aria-expanded={open}
        onBlur={() => setOpen(false)}
        onClick={(event) => {
          event.preventDefault();
          if (open) {
            setOpen(false);
          } else {
            show();
          }
        }}
        onFocus={show}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        onMouseEnter={show}
      >
        <Info size={13} />
      </button>
      {open && position && (
        <span
          ref={bubbleRef}
          className={`info-bubble info-bubble-${position.align} info-bubble-${position.placement}`}
          role="tooltip"
          style={{ left: position.left, top: position.top }}
        >
          {children}
        </span>
      )}
    </span>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en", { notation: value >= 10_000 ? "compact" : "standard" }).format(value);
}

function categoryLabel(category: ArtistCategory, known: boolean): string {
  if (category === "seed") return "Seed artist";
  return known ? "Known already" : "To discover";
}

function categoryClass(category: ArtistCategory): string {
  if (category === "seed") return "pill-seed";
  if (category === "known") return "pill-known";
  return "pill-discover";
}

function rankedToNode(artist: RankedArtist): GraphNode {
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
    category: artist.known ? "known" : "discover",
    known: artist.known,
    degree: artist.degree,
    seedSupport: artist.seedCount,
    seedNames: artist.seedNames,
    rank: artist.rank,
  };
}

type GraphEndpoint = number | { id: number };
type FilterableGraphLink = AnalyzeResponse["graph"]["links"][number] & {
  source: GraphEndpoint;
  target: GraphEndpoint;
};

function graphEndpointId(endpoint: GraphEndpoint): number {
  return typeof endpoint === "number" ? endpoint : endpoint.id;
}

function filterGraph(
  response: AnalyzeResponse | null,
  graphFilter: GraphFilter,
  likedByAtLeast: number,
): AnalyzeResponse["graph"] {
  if (!response) return { nodes: [], links: [] };
  const likedNodeIds = new Set(
    response.graph.nodes
      .filter((node) => {
        if (node.category === "seed") return false;
        if (node.seedSupport < likedByAtLeast) return false;
        if (graphFilter === "all") return true;
        return node.category === graphFilter;
      })
      .map((node) => node.id),
  );

  const seedIds = new Set<number>();
  const links = response.graph.links.flatMap((linkValue) => {
    const link = linkValue as FilterableGraphLink;
    const source = graphEndpointId(link.source);
    const target = graphEndpointId(link.target);
    const keep = likedNodeIds.has(target);
    if (keep) seedIds.add(source);
    return keep ? [{ ...link, source, target }] : [];
  });

  const nodeIds = new Set([...likedNodeIds, ...seedIds]);
  return {
    nodes: response.graph.nodes.filter((node) => nodeIds.has(node.id)),
    links,
  };
}

export default function Home() {
  const [profile, setProfile] = useState("luigi28000");
  const [maxSeedArtists, setMaxSeedArtists] = useState(40);
  const [likesPerSeed, setLikesPerSeed] = useState(50);
  const [graphDensity, setGraphDensity] = useState<"focused" | "expanded">("focused");
  const [graphFilter, setGraphFilter] = useState<GraphFilter>("all");
  const [likedByAtLeast, setLikedByAtLeast] = useState(1);
  const [rankingTab, setRankingTab] = useState<RankingTab>("discover");
  const [searchQuery, setSearchQuery] = useState("");
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState("Demo data");
  const [zoomSignal, setZoomSignal] = useState(0);
  const profileName = data?.profile.username || profile.trim() || "this profile";

  useEffect(() => {
    let active = true;
    fetch("/api/demo")
      .then((response) => response.json())
      .then((demo: AnalyzeResponse) => {
        if (!active) return;
        setData(demo);
        setSelectedNode(null);
      })
      .catch(() => {
        if (active) setError("Demo data could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, []);

  const visibleGraph = useMemo(
    () => filterGraph(data, graphFilter, likedByAtLeast),
    [data, graphFilter, likedByAtLeast],
  );

  const selectedNodeId = selectedNode?.id || null;
  const filteredRankings = useMemo(() => {
    const activeRankings = data?.rankings[rankingTab] || [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return activeRankings;
    return activeRankings.filter(
      (artist) =>
        artist.username.toLowerCase().includes(query) ||
        artist.seedNames.some((name) => name.toLowerCase().includes(query)),
    );
  }, [data, rankingTab, searchQuery]);

  async function loadDemo() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/demo");
      if (!response.ok) throw new Error("Demo data could not be loaded.");
      setData((await response.json()) as AnalyzeResponse);
      setSelectedNode(null);
      setSource("Demo data");
      setGraphFilter("all");
      setLikedByAtLeast(1);
      setRankingTab("discover");
      setSearchQuery("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }

  async function analyzeProfile() {
    setLoading(true);
    setError(null);
    setSelectedNode(null);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          maxSeedArtists,
          likesPerSeed,
          graphDensity,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Analysis failed.");
      setData(payload as AnalyzeResponse);
      setSource(`Live analysis for ${payload.profile.username}`);
      setGraphFilter("all");
      setLikedByAtLeast(1);
    } catch (analyzeError) {
      setError(analyzeError instanceof Error ? analyzeError.message : String(analyzeError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar-header" aria-label="Controls">
          <div className="brand-row">
            <div>
              <h1 className="brand-title">SoundCloud Explorer</h1>
              <p className="brand-subtitle">Which artists are listened to by artists I like or follow?</p>
            </div>
            <span className="pill pill-seed">
              <Radio size={14} />
              {source}
            </span>
          </div>

          <div className="form-grid">
            <label className="input-label">
              <span className="label-row">Profile</span>
              <input
                className="input"
                value={profile}
                onChange={(event) => setProfile(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void analyzeProfile();
                }}
                placeholder="username or SoundCloud URL"
              />
            </label>

            <div className="control-pair">
              <label className="input-label">
                <span className="label-row">
                  Seed artists
                  <InfoTip label="seed artists">
                    Artists {profileName} already likes or follows. The app starts from them to find related artists.
                  </InfoTip>
                </span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={80}
                  value={maxSeedArtists}
                  onChange={(event) => setMaxSeedArtists(Number(event.target.value))}
                />
              </label>
              <label className="input-label">
                <span className="label-row">
                  Likes per seed
                  <InfoTip label="likes per seed">
                    Read this many liked tracks for each seed artist. Higher values can reveal more overlap but take longer.
                  </InfoTip>
                </span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={100}
                  value={likesPerSeed}
                  onChange={(event) => setLikesPerSeed(Number(event.target.value))}
                />
              </label>
            </div>

            <label className="input-label">
              <span className="label-row">
                Graph density
                <InfoTip label="graph density">
                  Focused is easier to read. Expanded shows more artists and links when you want a denser graph.
                </InfoTip>
              </span>
              <select
                className="select"
                value={graphDensity}
                onChange={(event) => setGraphDensity(event.target.value as "focused" | "expanded")}
              >
                <option value="focused">Focused</option>
                <option value="expanded">Expanded</option>
              </select>
            </label>

            <div className="toolbar-row">
              <button className="button button-primary" onClick={analyzeProfile} disabled={loading || !profile.trim()}>
                {loading ? <Loader2 className="spinner" size={18} /> : <Search size={18} />}
                Analyze
              </button>
              <button className="button" onClick={loadDemo} disabled={loading}>
                <RefreshCw size={18} />
                Demo
              </button>
            </div>
          </div>
      </aside>

      <aside className="sidebar-body" aria-label="Results">
          {error && <div className="error-state">{error}</div>}

          {data ? (
            <>
              <div className="metric-grid">
                <div className="metric">
                  <div className="metric-value" style={{ color: "var(--seed)" }}>
                    {formatNumber(data.metrics.seeds)}
                  </div>
                  <div className="metric-label">
                    Seeds
                    <InfoTip label="seeds">
                      Artists {profileName} already likes or follows. They are the starting points of the graph.
                    </InfoTip>
                  </div>
                </div>
                <div className="metric">
                  <div className="metric-value" style={{ color: "var(--discover)" }}>
                    {formatNumber(data.metrics.discoverTotal)}
                  </div>
                  <div className="metric-label">
                    Discover
                    <InfoTip label="discover artists">
                      Artists liked by seed artists that {profileName} does not already like or follow.
                    </InfoTip>
                  </div>
                </div>
                <div className="metric">
                  <div className="metric-value" style={{ color: "var(--known)" }}>
                    {formatNumber(data.metrics.knownTotal)}
                  </div>
                  <div className="metric-label">
                    Known
                    <InfoTip label="known artists">
                      Artists {profileName} already likes or follows, and seed artists like too.
                    </InfoTip>
                  </div>
                </div>
              </div>

              {data.warnings.length > 0 && (
                <div className="warning-list">
                  {data.warnings.slice(0, 3).map((warning) => (
                    <div className="warning-row" key={warning}>
                      <AlertTriangle size={15} />
                      {warning}
                    </div>
                  ))}
                </div>
              )}

              <div className="tabs">
                <button
                  className={`tab ${rankingTab === "discover" ? "tab-active" : ""}`}
                  onClick={() => setRankingTab("discover")}
                >
                  Discover
                </button>
                <button
                  className={`tab ${rankingTab === "known" ? "tab-active" : ""}`}
                  onClick={() => setRankingTab("known")}
                >
                  Known
                </button>
              </div>

              <div className="artist-list">
                {filteredRankings.slice(0, 80).map((artist) => (
                  <button
                    className="artist-row"
                    key={artist.id}
                    onClick={() => setSelectedNode(rankedToNode(artist))}
                  >
                    <span className="artist-row-main">
                      <span className="artist-name">
                        {artist.rank}. {artist.username}
                      </span>
                      <span className={`pill ${artist.known ? "pill-known" : "pill-discover"}`}>
                        {artist.seedCount} seeds
                      </span>
                    </span>
                    <span className="artist-meta">{artist.seedNames.join(", ") || "No supporting seed names"}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">Loading demo network...</div>
          )}
      </aside>

      <section className="graph-pane">
        <div className="graph-toolbar">
          <input
            className="input floating-panel"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search artists"
            aria-label="Search artists"
          />
          <select
            className="select floating-panel"
            value={graphFilter}
            onChange={(event) => setGraphFilter(event.target.value as GraphFilter)}
            aria-label="Graph category filter"
          >
            <option value="all">All categories</option>
            <option value="discover">Discover only</option>
            <option value="known">Known only</option>
          </select>
          <div className="support-control floating-panel">
            <span className="support-copy">
              Liked by at least <strong>{likedByAtLeast}</strong>
              <InfoTip label="liked by at least">
                Show only artists liked by at least this many seed artists. Higher values make the graph less noisy.
              </InfoTip>
            </span>
            <input
              aria-label="Liked by at least"
              type="range"
              min={1}
              max={8}
              value={likedByAtLeast}
              onChange={(event) => setLikedByAtLeast(Number(event.target.value))}
            />
          </div>
          <button
            aria-label="Zoom to fit"
            className="button button-icon floating-panel"
            onClick={() => setZoomSignal((value) => value + 1)}
          >
            <Target size={18} />
          </button>
          {selectedNode && (
            <button
              aria-label="Clear selected artist"
              className="button button-icon floating-panel"
              onClick={() => setSelectedNode(null)}
            >
              <X size={18} />
            </button>
          )}
        </div>

        {visibleGraph.nodes.length ? (
          <NetworkGraph
            data={visibleGraph}
            selectedNodeId={selectedNodeId}
            searchQuery={searchQuery}
            zoomSignal={zoomSignal}
            onNodeSelect={setSelectedNode}
          />
        ) : (
          <div className="empty-state" style={{ position: "absolute", inset: 14, display: "grid", placeItems: "center" }}>
            No graph nodes match the current filters.
          </div>
        )}

        <div className="graph-status">
          <span className="pill pill-seed">
            <Users size={14} /> {formatNumber(visibleGraph.nodes.filter((node) => node.category === "seed").length)} seeds
          </span>
          <span className="pill pill-discover">
            <GitBranch size={14} />{" "}
            {formatNumber(visibleGraph.nodes.filter((node) => node.category === "discover").length)} discover
          </span>
          <span className="pill pill-known">
            <SlidersHorizontal size={14} /> {formatNumber(visibleGraph.links.length)} links
          </span>
        </div>

        {selectedNode && (
          <aside className="detail-panel floating-panel">
            <span className={`pill ${categoryClass(selectedNode.category)}`}>
              {categoryLabel(selectedNode.category, selectedNode.known)}
            </span>
            <h2 className="detail-title">{selectedNode.username}</h2>
            <div className="detail-row">
              <span>Known already</span>
              <strong className={`known-answer ${selectedNode.known ? "known-answer-yes" : "known-answer-no"}`}>
                {selectedNode.known ? "Yes" : "No"}
              </strong>
            </div>
            <div className="detail-row">
              <span>Liked by seed artists</span>
              <strong>{selectedNode.seedSupport}</strong>
            </div>
            <div className="detail-row">
              <span>Network degree</span>
              <strong>{selectedNode.degree}</strong>
            </div>
            {selectedNode.seedNames.length > 0 && (
              <div className="detail-row" style={{ display: "block" }}>
                <span>Listened by</span>
                <p style={{ margin: "6px 0 0", lineHeight: 1.4 }}>{selectedNode.seedNames.join(", ")}</p>
              </div>
            )}
            <a className="button" href={selectedNode.permalinkUrl} target="_blank" rel="noreferrer" style={{ width: "100%" }}>
              Open in SoundCloud
              <ExternalLink size={16} />
            </a>
          </aside>
        )}
      </section>
    </main>
  );
}
