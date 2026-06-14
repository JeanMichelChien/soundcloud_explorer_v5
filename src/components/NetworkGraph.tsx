"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { ForceGraphMethods, LinkObject, NodeObject } from "react-force-graph-2d";
import type { AnalyzeResponse, GraphLink, GraphNode } from "@/lib/contracts";

interface NetworkGraphProps {
  data: AnalyzeResponse["graph"];
  selectedNodeId: number | null;
  searchQuery: string;
  zoomSignal: number;
  onNodeSelect: (node: GraphNode) => void;
}

type ForceNode = GraphNode & {
  x?: number;
  y?: number;
};

type MutableGraphLink = GraphLink & {
  source: number | ForceNode;
  target: number | ForceNode;
};

function nodeColor(node: GraphNode): string {
  if (node.category === "seed") return "#ff6b1a";
  if (node.category === "known") return "#5b5fe8";
  return "#0ea68c";
}

function endpointId(endpoint: number | ForceNode): number {
  return typeof endpoint === "number" ? endpoint : endpoint.id;
}

const LABEL_SCREEN_FONT_SIZE = 12;
const LABEL_TOP_RANK_CUTOFF = 20;
const LABEL_SUPPORT_CUTOFF = 3;
const SHOW_MORE_LABELS_ZOOM = 1.75;

export default function NetworkGraph({
  data,
  selectedNodeId,
  searchQuery,
  zoomSignal,
  onNodeSelect,
}: NetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods<NodeObject<GraphNode>, LinkObject<GraphNode, GraphLink>> | undefined>(
    undefined,
  );
  const [dimensions, setDimensions] = useState({ width: 900, height: 700 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const resize = () => {
      setDimensions({
        width: Math.max(element.offsetWidth, 320),
        height: Math.max(element.offsetHeight, 420),
      });
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const searchMatchIds = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return new Set<number>();
    return new Set(
      data.nodes
        .filter((node) => node.username.toLowerCase().includes(query))
        .map((node) => node.id),
    );
  }, [data.nodes, searchQuery]);

  const highlightedIds = useMemo(() => {
    if (!selectedNodeId) return searchMatchIds;
    const ids = new Set<number>([selectedNodeId]);
    for (const link of data.links as MutableGraphLink[]) {
      const source = endpointId(link.source);
      const target = endpointId(link.target);
      if (source === selectedNodeId) ids.add(target);
      if (target === selectedNodeId) ids.add(source);
    }
    return ids;
  }, [data.links, searchMatchIds, selectedNodeId]);

  const zoomToFitPadding = dimensions.width <= 700 ? 155 : 110;

  useEffect(() => {
    if (!graphRef.current || !data.nodes.length) return;
    window.setTimeout(() => graphRef.current?.zoomToFit?.(500, zoomToFitPadding), 80);
  }, [data.nodes.length, data.links.length, zoomSignal, zoomToFitPadding]);

  useEffect(() => {
    if (!graphRef.current || !selectedNodeId) return;
    const selected = data.nodes.find((node) => node.id === selectedNodeId) as ForceNode | undefined;
    if (selected?.x === undefined || selected?.y === undefined) return;
    graphRef.current.centerAt?.(selected.x, selected.y, 500);
    graphRef.current.zoom?.(2.2, 500);
  }, [data.nodes, selectedNodeId]);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }} data-testid="network-graph">
      <ForceGraph2D
        ref={graphRef}
        width={dimensions.width}
        height={dimensions.height}
        graphData={data}
        backgroundColor="#fbfcff"
        cooldownTicks={120}
        dagMode={undefined}
        nodeRelSize={4}
        linkDirectionalParticles={0}
        linkColor={(linkValue) => {
          const link = linkValue as MutableGraphLink;
          const source = endpointId(link.source);
          const target = endpointId(link.target);
          if (!selectedNodeId && !searchMatchIds.size) return "rgba(18, 20, 23, 0.12)";
          return highlightedIds.has(source) && highlightedIds.has(target)
            ? "rgba(18, 20, 23, 0.42)"
            : "rgba(18, 20, 23, 0.05)";
        }}
        linkWidth={(linkValue) => {
          const link = linkValue as MutableGraphLink;
          const source = endpointId(link.source);
          const target = endpointId(link.target);
          return highlightedIds.has(source) && highlightedIds.has(target) ? 1.8 : 0.8;
        }}
        nodePointerAreaPaint={(nodeValue, color, context) => {
          const node = nodeValue as ForceNode;
          const radius = node.category === "seed" ? 9 : Math.max(5, Math.min(11, 4 + node.seedSupport));
          context.fillStyle = color;
          context.beginPath();
          context.arc(node.x || 0, node.y || 0, radius + 5, 0, 2 * Math.PI, false);
          context.fill();
        }}
        nodeCanvasObjectMode={() => "replace"}
        nodeCanvasObject={(nodeValue, context, globalScale) => {
          const node = nodeValue as ForceNode;
          const selected = selectedNodeId === node.id;
          const highlighted = highlightedIds.has(node.id);
          const matched = searchMatchIds.has(node.id);
          const dimmed = (selectedNodeId || searchMatchIds.size) && !highlighted;
          const radius = node.category === "seed" ? 8.5 : Math.max(4.5, Math.min(10.5, 3.8 + node.seedSupport));
          const color = nodeColor(node);

          context.save();
          context.globalAlpha = dimmed ? 0.22 : 1;
          context.beginPath();
          context.arc(node.x || 0, node.y || 0, selected || matched ? radius + 3 : radius, 0, 2 * Math.PI, false);
          context.fillStyle = selected || matched ? "#111827" : color;
          context.fill();
          context.lineWidth = selected || matched ? 2.5 / globalScale : 1 / globalScale;
          context.strokeStyle = selected || matched ? color : "rgba(255, 255, 255, 0.9)";
          context.stroke();

          const shouldLabel =
            node.category === "seed" ||
            selected ||
            matched ||
            globalScale > SHOW_MORE_LABELS_ZOOM ||
            node.seedSupport >= LABEL_SUPPORT_CUTOFF ||
            (node.rank !== undefined && node.rank <= LABEL_TOP_RANK_CUTOFF);

          if (shouldLabel && !dimmed) {
            const fontSize = LABEL_SCREEN_FONT_SIZE / globalScale;
            const padX = 5 / globalScale;
            const padY = 3 / globalScale;
            const lineHeight = (LABEL_SCREEN_FONT_SIZE + 7) / globalScale;
            const label = node.username.length > 28 ? `${node.username.slice(0, 27)}...` : node.username;
            context.font = `700 ${fontSize}px Inter, ui-sans-serif, system-ui`;
            const textWidth = context.measureText(label).width;
            const x = node.x || 0;
            const y = (node.y || 0) + radius + lineHeight;

            context.fillStyle = "rgba(255, 255, 255, 0.88)";
            context.fillRect(x - textWidth / 2 - padX, y - fontSize / 2 - padY, textWidth + padX * 2, fontSize + padY * 2);
            context.fillStyle = "#121417";
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillText(label, x, y);
          }
          context.restore();
        }}
        onNodeClick={(node) => onNodeSelect(node as GraphNode)}
      />
    </div>
  );
}
