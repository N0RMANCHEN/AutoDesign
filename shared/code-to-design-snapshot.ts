import type { CapabilityLaneId } from "./capability-lanes.js";

export type CodeToDesignViewport = {
  width: number;
  height: number;
  deviceScaleFactor: number;
};

export type CodeToDesignViewportKey = "desktop" | "tablet" | "mobile" | string;

export type CodeToDesignRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CodeToDesignNodeRole =
  | "frame"
  | "text"
  | "image"
  | "shape"
  | "group"
  | "unknown";

export type CodeToDesignStyleSnapshot = {
  display: string;
  position: string;
  color: string;
  opacity: number;
  backgroundColor: string;
  backgroundImage: string;
  borderTopWidth: string;
  borderRightWidth: string;
  borderBottomWidth: string;
  borderLeftWidth: string;
  borderTopColor: string;
  borderRightColor: string;
  borderBottomColor: string;
  borderLeftColor: string;
  borderTopLeftRadius: string;
  borderTopRightRadius: string;
  borderBottomRightRadius: string;
  borderBottomLeftRadius: string;
  fontFamily: string;
  fontStyle?: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  textAlign: string;
  textTransform: string;
  objectFit: string;
  gridTemplateColumns: string;
  gridTemplateRows: string;
  gap: string;
  rowGap: string;
  columnGap: string;
  flexDirection?: string;
  justifyContent?: string;
  alignItems?: string;
  alignSelf?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
};

export type CodeToDesignImageAsset = {
  src: string | null;
  alt: string | null;
  dataUrl: string | null;
};

export type CodeToDesignNodeSnapshot = {
  id: string;
  parentId: string | null;
  domPath: string;
  tagName: string;
  className?: string | null;
  role: CodeToDesignNodeRole;
  name: string;
  visible: boolean;
  rect: CodeToDesignRect;
  textContent: string | null;
  fontFamilyCandidates?: string[];
  resolvedBrowserFontFamily?: string | null;
  resolvedBrowserFontStyle?: string | null;
  styles: CodeToDesignStyleSnapshot;
  image: CodeToDesignImageAsset | null;
};

export type CodeToDesignPageSnapshot = {
  title: string;
  urlPath: string;
  scrollWidth: number;
  scrollHeight: number;
  backgroundColor: string;
  backgroundImage: string;
};

export type CodeToDesignCaptureSummary = {
  nodeCount: number;
  textNodeCount: number;
  imageNodeCount: number;
  shapeNodeCount: number;
};

export type CodeToDesignResponsiveVariantSnapshot = {
  viewportKey: CodeToDesignViewportKey;
  viewport: CodeToDesignViewport;
  page: CodeToDesignPageSnapshot;
  summary: CodeToDesignCaptureSummary;
  nodes: CodeToDesignNodeSnapshot[];
};

export type CodeToDesignRuntimeSnapshot = {
  kind: "code_to_design_runtime_snapshot";
  version: "v2";
  lane: CapabilityLaneId;
  projectRoot: string | null;
  projectName: string | null;
  route: string;
  entryPaths: string[];
  viewportKey: CodeToDesignViewportKey;
  viewport: CodeToDesignViewport;
  page: CodeToDesignPageSnapshot;
  summary: CodeToDesignCaptureSummary;
  nodes: CodeToDesignNodeSnapshot[];
  responsiveVariants: CodeToDesignResponsiveVariantSnapshot[];
  warnings: string[];
  assumptions: string[];
};

function compareNodes(left: CodeToDesignNodeSnapshot, right: CodeToDesignNodeSnapshot) {
  const yOrder = left.rect.y - right.rect.y;
  if (Math.abs(yOrder) > 0.1) {
    return yOrder;
  }
  const xOrder = left.rect.x - right.rect.x;
  if (Math.abs(xOrder) > 0.1) {
    return xOrder;
  }
  return left.domPath.localeCompare(right.domPath);
}

const GENERIC_FONT_FAMILIES = new Set([
  "-apple-system",
  "blinkmacsystemfont",
  "system-ui",
  "sans-serif",
  "serif",
  "monospace",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "cursive",
  "fantasy",
]);

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function parseCssFontFamilies(value: string | undefined) {
  return uniqueStrings(
    String(value || "")
      .split(",")
      .map((item) => item.trim().replace(/^['"]|['"]$/g, "")),
  );
}

function isGenericFontFamily(value: string | null | undefined) {
  return GENERIC_FONT_FAMILIES.has(String(value || "").trim().toLowerCase());
}

function normalizeResolvedBrowserFontFamily(node: CodeToDesignNodeSnapshot) {
  const resolved = String(node.resolvedBrowserFontFamily || "").trim();
  if (!resolved) {
    return null;
  }
  if (!isGenericFontFamily(resolved)) {
    return resolved;
  }
  const families = uniqueStrings([
    ...(node.fontFamilyCandidates || []),
    ...parseCssFontFamilies(node.styles.fontFamily),
  ]);
  return families.find((family) => !isGenericFontFamily(family)) || resolved;
}

function normalizeSnapshotNode(node: CodeToDesignNodeSnapshot): CodeToDesignNodeSnapshot {
  if (node.role !== "text") {
    return node;
  }
  return {
    ...node,
    fontFamilyCandidates: uniqueStrings([
      ...(node.fontFamilyCandidates || []),
      ...parseCssFontFamilies(node.styles.fontFamily),
    ]),
    resolvedBrowserFontFamily: normalizeResolvedBrowserFontFamily(node),
  };
}

export function summarizeCodeToDesignNodes(nodes: CodeToDesignNodeSnapshot[]): CodeToDesignCaptureSummary {
  return {
    nodeCount: nodes.length,
    textNodeCount: nodes.filter((node) => node.role === "text").length,
    imageNodeCount: nodes.filter((node) => node.role === "image").length,
    shapeNodeCount: nodes.filter((node) => node.role === "shape").length,
  };
}

export function buildCodeToDesignRuntimeSnapshot(params: {
  projectRoot?: string | null;
  projectName?: string | null;
  route: string;
  entryPaths?: string[];
  viewportKey?: CodeToDesignViewportKey;
  viewport: CodeToDesignViewport;
  page: CodeToDesignPageSnapshot;
  nodes: CodeToDesignNodeSnapshot[];
  responsiveVariants?: Array<{
    viewportKey: CodeToDesignViewportKey;
    viewport: CodeToDesignViewport;
    page: CodeToDesignPageSnapshot;
    nodes: CodeToDesignNodeSnapshot[];
  }>;
  warnings?: string[];
}): CodeToDesignRuntimeSnapshot {
  const nodes = params.nodes.map(normalizeSnapshotNode).sort(compareNodes);
  const responsiveVariants = (params.responsiveVariants?.length
    ? params.responsiveVariants
    : [
        {
          viewportKey: params.viewportKey || "desktop",
          viewport: params.viewport,
          page: params.page,
          nodes,
        },
      ])
    .map((variant) => {
      const variantNodes = variant.nodes.map(normalizeSnapshotNode).sort(compareNodes);
      return {
        viewportKey: variant.viewportKey,
        viewport: variant.viewport,
        page: variant.page,
        nodes: variantNodes,
        summary: summarizeCodeToDesignNodes(variantNodes),
      } satisfies CodeToDesignResponsiveVariantSnapshot;
    });
  return {
    kind: "code_to_design_runtime_snapshot",
    version: "v2",
    lane: "code_to_design",
    projectRoot: params.projectRoot ?? null,
    projectName: params.projectName ?? null,
    route: params.route,
    entryPaths: [...new Set((params.entryPaths ?? []).map((item) => item.trim()).filter(Boolean))],
    viewportKey: params.viewportKey || responsiveVariants[0]?.viewportKey || "desktop",
    viewport: params.viewport,
    page: params.page,
    summary: summarizeCodeToDesignNodes(nodes),
    nodes,
    responsiveVariants,
    warnings: [...new Set((params.warnings ?? []).map((item) => item.trim()).filter(Boolean))],
    assumptions: [
      responsiveVariants.length > 1
        ? "当前 snapshot 包含多个 viewport 探针，可用于响应式布局推断和验收。"
        : "当前 snapshot 代表单一 viewport 下的静态态。",
      "布局与样式以浏览器运行态 computed style 为准，而不是源码文本直读。",
      "字体仍需在浏览器与 Figma 本机环境中逐项校验，避免换行和字宽漂移。",
    ],
  };
}

export function collectRenderableNodes(snapshot: CodeToDesignRuntimeSnapshot) {
  return snapshot.nodes.filter((node) =>
    node.visible &&
    node.rect.width > 0 &&
    node.rect.height > 0 &&
    (node.role === "text" || node.role === "image" || node.role === "shape"),
  );
}

export function combineResponsiveCodeToDesignSnapshots(params: {
  primaryViewportKey: CodeToDesignViewportKey;
  snapshots: CodeToDesignRuntimeSnapshot[];
}) {
  const snapshots = [...params.snapshots];
  if (!snapshots.length) {
    throw new Error("at least one runtime snapshot is required");
  }
  const primary =
    snapshots.find((snapshot) => snapshot.viewportKey === params.primaryViewportKey) || snapshots[0]!;
  const responsiveVariants = snapshots.map((snapshot) => ({
    viewportKey: snapshot.viewportKey,
    viewport: snapshot.viewport,
    page: snapshot.page,
    nodes: snapshot.nodes,
  }));
  return buildCodeToDesignRuntimeSnapshot({
    projectRoot: primary.projectRoot,
    projectName: primary.projectName,
    route: primary.route,
    entryPaths: primary.entryPaths,
    viewportKey: primary.viewportKey,
    viewport: primary.viewport,
    page: primary.page,
    nodes: primary.nodes,
    responsiveVariants,
    warnings: [...new Set(snapshots.flatMap((snapshot) => snapshot.warnings || []))],
  });
}

export function getResponsiveVariantSnapshot(
  snapshot: CodeToDesignRuntimeSnapshot,
  viewportKey: CodeToDesignViewportKey,
) {
  return listResponsiveVariants(snapshot).find((variant) => variant.viewportKey === viewportKey) || null;
}

export function listResponsiveVariants(snapshot: Pick<
  CodeToDesignRuntimeSnapshot,
  "viewportKey" | "viewport" | "page" | "summary" | "nodes" | "responsiveVariants"
>) {
  return snapshot.responsiveVariants?.length
    ? snapshot.responsiveVariants
    : [
        {
          viewportKey: snapshot.viewportKey || "desktop",
          viewport: snapshot.viewport,
          page: snapshot.page,
          summary: snapshot.summary,
          nodes: snapshot.nodes,
        } satisfies CodeToDesignResponsiveVariantSnapshot,
      ];
}
