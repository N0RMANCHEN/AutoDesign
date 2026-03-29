import type {
  PluginAvailableFont,
  PluginCommandExecutionResult,
  PluginNodeInspection,
} from "./plugin-bridge.js";
import type { CodeToDesignFontInstallAssessment } from "./code-to-design-fonts.js";
import { listResponsiveVariants, type CodeToDesignRuntimeSnapshot } from "./code-to-design-snapshot.js";
import type { CodeToDesignLayoutNode } from "./code-to-design-plan.js";

export type CodeToDesignGateStatus = "pass" | "fail" | "pending";
export type CodeToDesignQualityPhase = "preflight" | "live_acceptance";

export type CodeToDesignStructureAssessment = {
  status: CodeToDesignGateStatus;
  score: number;
  requiredContainerNames: string[];
  foundContainerNames: string[];
  missingContainerNames: string[];
  notes: string[];
};

export type CodeToDesignNamingAssessment = {
  status: CodeToDesignGateStatus;
  score: number;
  invalidNames: string[];
  notes: string[];
};

export type CodeToDesignFigmaTreeMismatch = {
  analysisRefId: string;
  nodeName: string;
  field: string;
  expected: string | number | boolean | null;
  actual: string | number | boolean | null;
};

export type CodeToDesignFigmaTreeAssessment = {
  status: CodeToDesignGateStatus;
  score: number;
  plannedNodeCount: number;
  inspectedNodeCount: number;
  missingAnalysisRefs: string[];
  unexpectedAbsoluteAnalysisRefs: string[];
  mismatches: CodeToDesignFigmaTreeMismatch[];
  notes: string[];
};

export type CodeToDesignFontAlignmentAssessment = {
  status: CodeToDesignGateStatus;
  score: number;
  browserResolvedCount: number;
  missingBrowserResolvedNodeIds: string[];
  runtimeReceiptsCompared: number;
  mismatches: Array<{
    nodeId: string;
    browserResolvedFamily: string | null;
    browserResolvedStyle: string | null;
    figmaResolvedFamily: string | null;
    figmaResolvedStyle: string | null;
  }>;
  notes: string[];
};

export type CodeToDesignFontEnvironmentAssessment = {
  status: CodeToDesignGateStatus;
  score: number;
  catalogFontCount: number;
  missingFonts: Array<{
    family: string;
    style: string | null;
  }>;
  notes: string[];
};

export type CodeToDesignVisualDiffGate = {
  id: string;
  label: string;
  metric: string;
  comparator: string;
  threshold: number;
  actual: number;
  passed: boolean;
  hard: boolean;
};

export type CodeToDesignVisualDiffHotspot = {
  id: string;
  score: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type CodeToDesignVisualDiffAssessment = {
  status: CodeToDesignGateStatus;
  score: number | null;
  compositeScore: number | null;
  artifactPaths: string[];
  acceptanceGates: CodeToDesignVisualDiffGate[];
  hotspots: CodeToDesignVisualDiffHotspot[];
  notes: string[];
};

export type CodeToDesignResponsiveProbeAssessment = {
  viewportKey: string;
  status: CodeToDesignGateStatus;
  score: number | null;
  figmaTreeStatus: CodeToDesignGateStatus;
  visualDiffStatus: CodeToDesignGateStatus;
  compositeScore: number | null;
  artifactPaths: string[];
  notes: string[];
};

export type CodeToDesignResponsiveAssessment = {
  status: CodeToDesignGateStatus;
  score: number | null;
  requiredViewportKeys: string[];
  observedViewportKeys: string[];
  probes: CodeToDesignResponsiveProbeAssessment[];
  notes: string[];
};

export type CodeToDesignQualityReport = {
  kind: "code_to_design_quality_report";
  version: "v4";
  phase: CodeToDesignQualityPhase;
  route: string;
  pageTitle: string;
  overallStatus: CodeToDesignGateStatus;
  structure: CodeToDesignStructureAssessment;
  naming: CodeToDesignNamingAssessment;
  figmaTree: CodeToDesignFigmaTreeAssessment;
  fontInstall: CodeToDesignFontInstallAssessment;
  fontEnvironment: CodeToDesignFontEnvironmentAssessment;
  fontAlignment: CodeToDesignFontAlignmentAssessment;
  visualDiff: CodeToDesignVisualDiffAssessment;
  responsive: CodeToDesignResponsiveAssessment;
  warnings: string[];
};

const INVALID_NAME_PATTERN = /^(?:div|span|section|aside|figure|header|main|p|img|h[1-6]|figcaption)$/i;

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeFontFamilyKey(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "");
}

function normalizeFontStyleKey(value: string | null | undefined) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "");
  if (!normalized || normalized === "regular" || normalized === "roman" || normalized === "normal" || normalized === "book") {
    return "regular";
  }
  if (normalized === "semibold" || normalized === "semibd") {
    return "semibold";
  }
  if (normalized === "bold") {
    return "bold";
  }
  if (normalized === "medium") {
    return "medium";
  }
  if (normalized === "light") {
    return "light";
  }
  return normalized;
}

function catalogIncludesFont(
  catalog: PluginAvailableFont[],
  requirement: { family: string; style: string | null },
) {
  const familyKey = normalizeFontFamilyKey(requirement.family);
  const styleKey = normalizeFontStyleKey(requirement.style);
  return catalog.some(
    (font) =>
      normalizeFontFamilyKey(font.family) === familyKey &&
      normalizeFontStyleKey(font.style) === styleKey,
  );
}

function flattenLayoutTree(root: CodeToDesignLayoutNode): CodeToDesignLayoutNode[] {
  const nodes: CodeToDesignLayoutNode[] = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    nodes.push(node);
    stack.push(...[...node.children].reverse());
  }
  return nodes;
}

function determineOverallStatus(statuses: CodeToDesignGateStatus[]): CodeToDesignGateStatus {
  if (statuses.includes("fail")) {
    return "fail";
  }
  if (statuses.includes("pending")) {
    return "pending";
  }
  return "pass";
}

function analysisRefIdForLayoutNode(nodeId: string) {
  return nodeId === "page-root" ? "code-to-design:page-root" : `code-to-design:layout:${nodeId}`;
}

function expectedNodeTypesForLayoutNode(node: CodeToDesignLayoutNode) {
  switch (node.kind) {
    case "frame":
      return ["FRAME"];
    case "text":
      return ["TEXT"];
    case "image":
      return ["RECTANGLE"];
    case "line":
      return ["LINE"];
    case "svg":
      return ["FRAME", "GROUP", "VECTOR"];
    default:
      return [];
  }
}

function normalizeAlignment(value: string | undefined | null) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "center" || normalized === "right" || normalized === "justified") {
    return normalized;
  }
  return "left";
}

function normalizeFigmaAlignment(value: string | undefined | null) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "center" || normalized === "right" || normalized === "justified") {
    return normalized;
  }
  return normalized === "left" ? "left" : "left";
}

function compareNumber(
  mismatches: CodeToDesignFigmaTreeMismatch[],
  params: {
    analysisRefId: string;
    nodeName: string;
    field: string;
    expected: number | undefined | null;
    actual: number | undefined | null;
    tolerance?: number;
  },
) {
  if (!Number.isFinite(params.expected)) {
    return;
  }
  if (!Number.isFinite(params.actual)) {
    mismatches.push({
      analysisRefId: params.analysisRefId,
      nodeName: params.nodeName,
      field: params.field,
      expected: params.expected ?? null,
      actual: params.actual ?? null,
    });
    return;
  }
  const tolerance = params.tolerance ?? 1;
  if (Math.abs(Number(params.expected) - Number(params.actual)) > tolerance) {
    mismatches.push({
      analysisRefId: params.analysisRefId,
      nodeName: params.nodeName,
      field: params.field,
      expected: Number(params.expected),
      actual: Number(params.actual),
    });
  }
}

function compareString(
  mismatches: CodeToDesignFigmaTreeMismatch[],
  params: {
    analysisRefId: string;
    nodeName: string;
    field: string;
    expected: string | undefined | null;
    actual: string | undefined | null;
  },
) {
  if (params.expected === undefined || params.expected === null) {
    return;
  }
  const expected = String(params.expected || "").trim();
  const actual = String(params.actual || "").trim();
  if (expected !== actual) {
    mismatches.push({
      analysisRefId: params.analysisRefId,
      nodeName: params.nodeName,
      field: params.field,
      expected: expected || null,
      actual: actual || null,
    });
  }
}

function buildFigmaTreeAssessment(params: {
  phase: CodeToDesignQualityPhase;
  layoutTree: CodeToDesignLayoutNode;
  inspectedNodes?: PluginNodeInspection[];
}) {
  const layoutNodes = flattenLayoutTree(params.layoutTree);
  const actualNodes = params.inspectedNodes || [];
  if (!actualNodes.length) {
    return {
      status: params.phase === "live_acceptance" ? "fail" : "pending",
      score: params.phase === "live_acceptance" ? 0 : 50,
      plannedNodeCount: layoutNodes.length,
      inspectedNodeCount: 0,
      missingAnalysisRefs: [],
      unexpectedAbsoluteAnalysisRefs: [],
      mismatches: [],
      notes: [
        params.phase === "live_acceptance"
          ? "figma tree inspection artifacts are missing for live acceptance."
          : "figma tree inspection has not been executed yet.",
      ],
    } satisfies CodeToDesignFigmaTreeAssessment;
  }

  const actualByAnalysisRef = new Map<string, PluginNodeInspection>();
  for (const node of actualNodes) {
    if (node.analysisRefId && !actualByAnalysisRef.has(node.analysisRefId)) {
      actualByAnalysisRef.set(node.analysisRefId, node);
    }
  }

  const missingAnalysisRefs: string[] = [];
  const unexpectedAbsoluteAnalysisRefs: string[] = [];
  const mismatches: CodeToDesignFigmaTreeMismatch[] = [];

  for (const plannedNode of layoutNodes) {
    const analysisRefId = analysisRefIdForLayoutNode(plannedNode.id);
    const actualNode = actualByAnalysisRef.get(analysisRefId);
    if (!actualNode) {
      missingAnalysisRefs.push(analysisRefId);
      continue;
    }

    const allowedTypes = expectedNodeTypesForLayoutNode(plannedNode);
    if (allowedTypes.length > 0 && !allowedTypes.includes(actualNode.type)) {
      mismatches.push({
        analysisRefId,
        nodeName: plannedNode.name,
        field: "type",
        expected: allowedTypes.join("|"),
        actual: actualNode.type || null,
      });
    }

    if (plannedNode.absolute) {
      compareString(mismatches, {
        analysisRefId,
        nodeName: plannedNode.name,
        field: "layoutPositioning",
        expected: "ABSOLUTE",
        actual: actualNode.layoutPositioning,
      });
    } else if (actualNode.layoutPositioning === "ABSOLUTE") {
      unexpectedAbsoluteAnalysisRefs.push(analysisRefId);
    }

    if (plannedNode.kind === "frame") {
      compareString(mismatches, {
        analysisRefId,
        nodeName: plannedNode.name,
        field: "layoutMode",
        expected: plannedNode.layout?.mode || "NONE",
        actual: actualNode.layoutMode || "NONE",
      });
      compareString(mismatches, {
        analysisRefId,
        nodeName: plannedNode.name,
        field: "layoutWrap",
        expected: plannedNode.layout?.layoutWrap || null,
        actual: actualNode.layoutWrap,
      });
      compareString(mismatches, {
        analysisRefId,
        nodeName: plannedNode.name,
        field: "primaryAxisSizingMode",
        expected: plannedNode.layout?.primaryAxisSizingMode || null,
        actual: actualNode.primaryAxisSizingMode,
      });
      compareString(mismatches, {
        analysisRefId,
        nodeName: plannedNode.name,
        field: "counterAxisSizingMode",
        expected: plannedNode.layout?.counterAxisSizingMode || null,
        actual: actualNode.counterAxisSizingMode,
      });
      compareNumber(mismatches, {
        analysisRefId,
        nodeName: plannedNode.name,
        field: "itemSpacing",
        expected: plannedNode.layout?.itemSpacing,
        actual: actualNode.itemSpacing,
      });
      compareNumber(mismatches, {
        analysisRefId,
        nodeName: plannedNode.name,
        field: "counterAxisSpacing",
        expected: plannedNode.layout?.counterAxisSpacing,
        actual: actualNode.counterAxisSpacing,
      });
      compareNumber(mismatches, {
        analysisRefId,
        nodeName: plannedNode.name,
        field: "paddingLeft",
        expected: plannedNode.layout?.paddingLeft,
        actual: actualNode.paddingLeft,
      });
      compareNumber(mismatches, {
        analysisRefId,
        nodeName: plannedNode.name,
        field: "paddingRight",
        expected: plannedNode.layout?.paddingRight,
        actual: actualNode.paddingRight,
      });
      compareNumber(mismatches, {
        analysisRefId,
        nodeName: plannedNode.name,
        field: "paddingTop",
        expected: plannedNode.layout?.paddingTop,
        actual: actualNode.paddingTop,
      });
      compareNumber(mismatches, {
        analysisRefId,
        nodeName: plannedNode.name,
        field: "paddingBottom",
        expected: plannedNode.layout?.paddingBottom,
        actual: actualNode.paddingBottom,
      });
      compareNumber(mismatches, {
        analysisRefId,
        nodeName: plannedNode.name,
        field: "width",
        expected: plannedNode.rect.width,
        actual: actualNode.width,
      });
      compareNumber(mismatches, {
        analysisRefId,
        nodeName: plannedNode.name,
        field: "height",
        expected: plannedNode.rect.height,
        actual: actualNode.height,
      });
      compareNumber(mismatches, {
        analysisRefId,
        nodeName: plannedNode.name,
        field: "minWidth",
        expected: plannedNode.layout?.minWidth,
        actual: actualNode.minWidth,
      });
      compareNumber(mismatches, {
        analysisRefId,
        nodeName: plannedNode.name,
        field: "maxWidth",
        expected: plannedNode.layout?.maxWidth,
        actual: actualNode.maxWidth,
      });
    }

    if (plannedNode.layoutChild?.layoutAlign !== undefined) {
      compareString(mismatches, {
        analysisRefId,
        nodeName: plannedNode.name,
        field: "layoutAlign",
        expected: plannedNode.layoutChild.layoutAlign,
        actual: actualNode.layoutAlign,
      });
    }
    if (plannedNode.layoutChild?.layoutGrow !== undefined) {
      compareNumber(mismatches, {
        analysisRefId,
        nodeName: plannedNode.name,
        field: "layoutGrow",
        expected: plannedNode.layoutChild.layoutGrow,
        actual: actualNode.layoutGrow,
        tolerance: 0.01,
      });
    }

    if (plannedNode.kind === "text") {
      compareString(mismatches, {
        analysisRefId,
        nodeName: plannedNode.name,
        field: "textAutoResize",
        expected: plannedNode.textStyle?.textAutoResize || "NONE",
        actual: actualNode.textAutoResize,
      });
      compareString(mismatches, {
        analysisRefId,
        nodeName: plannedNode.name,
        field: "textAlignment",
        expected: normalizeAlignment(plannedNode.textStyle?.alignment),
        actual: normalizeFigmaAlignment(actualNode.textAlignment),
      });
    }
  }

  const weightedErrorCount =
    missingAnalysisRefs.length * 4 + unexpectedAbsoluteAnalysisRefs.length * 2 + mismatches.length;
  const score = Math.max(0, 100 - weightedErrorCount * 4);
  const status: CodeToDesignGateStatus =
    missingAnalysisRefs.length || unexpectedAbsoluteAnalysisRefs.length || mismatches.length
      ? "fail"
      : "pass";

  return {
    status,
    score,
    plannedNodeCount: layoutNodes.length,
    inspectedNodeCount: actualNodes.length,
    missingAnalysisRefs,
    unexpectedAbsoluteAnalysisRefs,
    mismatches,
    notes: [
      missingAnalysisRefs.length
        ? `missing planned figma nodes: ${missingAnalysisRefs.join(", ")}`
        : "all planned nodes are present in the inspected figma subtree.",
      unexpectedAbsoluteAnalysisRefs.length
        ? `unexpected absolute nodes: ${unexpectedAbsoluteAnalysisRefs.join(", ")}`
        : "no unexpected absolute-positioned figma nodes were detected.",
      mismatches.length
        ? `figma tree mismatches: ${mismatches.length}`
        : "figma tree layout properties match the planned semantic layout contract.",
    ],
  } satisfies CodeToDesignFigmaTreeAssessment;
}

export function buildCodeToDesignQualityReport(params: {
  snapshot: CodeToDesignRuntimeSnapshot;
  layoutTree: CodeToDesignLayoutNode;
  requiredContainerNames: string[];
  phase?: CodeToDesignQualityPhase;
  fontInstall?: CodeToDesignFontInstallAssessment;
  fontCatalog?: PluginAvailableFont[];
  runtimeResults?: PluginCommandExecutionResult[];
  inspectedNodes?: PluginNodeInspection[];
  visualDiff?: {
    score?: number;
    compositeScore?: number;
    artifactPaths?: string[];
    notes?: string[];
    acceptanceGates?: CodeToDesignVisualDiffGate[];
    hotspots?: CodeToDesignVisualDiffHotspot[];
  };
  responsive?: {
    requiredViewportKeys?: string[];
    probes?: CodeToDesignResponsiveProbeAssessment[];
  };
}): CodeToDesignQualityReport {
  const phase = params.phase || "preflight";
  const layoutNodes = flattenLayoutTree(params.layoutTree);
  const containerNames = uniqueStrings(layoutNodes.filter((node) => node.kind === "frame").map((node) => node.name));
  const missingContainerNames = params.requiredContainerNames.filter((name) => !containerNames.includes(name));
  const structureScore =
    params.requiredContainerNames.length > 0
      ? Math.round(((params.requiredContainerNames.length - missingContainerNames.length) / params.requiredContainerNames.length) * 100)
      : 100;
  const structure: CodeToDesignStructureAssessment = {
    status: missingContainerNames.length ? "fail" : "pass",
    score: structureScore,
    requiredContainerNames: params.requiredContainerNames,
    foundContainerNames: containerNames,
    missingContainerNames,
    notes: missingContainerNames.length
      ? [`missing semantic containers: ${missingContainerNames.join(", ")}`]
      : ["semantic container coverage is complete for the required editorial frames."],
  };

  const invalidNames = uniqueStrings(
    layoutNodes
      .map((node) => node.name)
      .filter((name) => !name || INVALID_NAME_PATTERN.test(name)),
  );
  const naming: CodeToDesignNamingAssessment = {
    status: invalidNames.length ? "fail" : "pass",
    score: invalidNames.length ? Math.max(0, 100 - invalidNames.length * 10) : 100,
    invalidNames,
    notes: invalidNames.length
      ? ["layout tree still contains raw DOM tag names."]
      : ["semantic english naming is stable and free of raw DOM tag labels."],
  };

  const figmaTree = buildFigmaTreeAssessment({
    phase,
    layoutTree: params.layoutTree,
    inspectedNodes: params.inspectedNodes,
  });

  const fontInstall: CodeToDesignFontInstallAssessment =
    params.fontInstall ||
    {
      status: phase === "live_acceptance" ? "fail" : "pending",
      manifestPath: "",
      bundleRoot: "",
      targetDir: null,
      installAttempted: false,
      requiredFonts: [],
      missingBrowserResolvedNodeIds: [],
      missingManifestEntries: [],
      missingFiles: [],
      autoResolvedEntries: [],
      resolvedFonts: [],
      installedFiles: [],
      skippedFiles: [],
      notes: [
        phase === "live_acceptance"
          ? "font installation preflight is missing from live acceptance."
          : "font installation preflight has not been executed yet.",
      ],
    };

  const fontCatalog = [...(params.fontCatalog || [])];
  const missingCatalogFonts = fontInstall.requiredFonts
    .filter((requirement) => !catalogIncludesFont(fontCatalog, requirement))
    .map((requirement) => ({
      family: requirement.family,
      style: requirement.style,
    }));
  const fontEnvironment: CodeToDesignFontEnvironmentAssessment = {
    status:
      !fontCatalog.length && phase !== "live_acceptance"
        ? "pending"
        : !fontCatalog.length || missingCatalogFonts.length
          ? "fail"
          : "pass",
    score:
      !fontCatalog.length
        ? phase === "live_acceptance"
          ? 0
          : 50
        : missingCatalogFonts.length
          ? Math.max(0, 100 - missingCatalogFonts.length * 20)
          : 100,
    catalogFontCount: fontCatalog.length,
    missingFonts: missingCatalogFonts,
    notes: [
      !fontCatalog.length
        ? phase === "live_acceptance"
          ? "figma font catalog is missing from live acceptance."
          : "figma font catalog has not been probed yet."
        : "figma font catalog is available for the active session.",
      missingCatalogFonts.length
        ? `current figma session is missing exact fonts: ${missingCatalogFonts.map((font) => `${font.family}/${font.style || "Regular"}`).join(", ")}`
        : fontCatalog.length
          ? "active figma session exposes every required browser-resolved font family/style."
          : "font catalog coverage has not been evaluated yet.",
    ],
  };

  const textNodes = params.snapshot.nodes.filter((node) => node.role === "text");
  const missingBrowserResolvedNodeIds = textNodes
    .filter((node) => !node.resolvedBrowserFontFamily)
    .map((node) => node.id);
  const browserResolvedCount = textNodes.length - missingBrowserResolvedNodeIds.length;
  const fontReceipts = (params.runtimeResults || [])
    .flatMap((result) => result.createdNodeReceipts || [])
    .filter((receipt) => receipt.fontResolution);
  const mismatches = fontReceipts
    .filter((receipt) => receipt.fontResolution?.deviatesFromBrowser)
    .map((receipt) => ({
      nodeId: receipt.nodeId,
      browserResolvedFamily: receipt.fontResolution?.browserResolvedFamily || null,
      browserResolvedStyle: receipt.fontResolution?.browserResolvedStyle || null,
      figmaResolvedFamily: receipt.fontResolution?.figmaResolvedFamily || null,
      figmaResolvedStyle: receipt.fontResolution?.figmaResolvedStyle || null,
    }));

  let fontStatus: CodeToDesignGateStatus = "pending";
  if (missingBrowserResolvedNodeIds.length) {
    fontStatus = "fail";
  } else if (!fontReceipts.length) {
    fontStatus = phase === "live_acceptance" ? "fail" : "pending";
  } else {
    fontStatus = mismatches.length ? "fail" : "pass";
  }
  const fontAlignment: CodeToDesignFontAlignmentAssessment = {
    status: fontStatus,
    score:
      missingBrowserResolvedNodeIds.length > 0
        ? Math.max(0, 100 - missingBrowserResolvedNodeIds.length * 10)
        : mismatches.length
          ? Math.max(0, 100 - mismatches.length * 20)
          : fontReceipts.length
            ? 100
            : phase === "live_acceptance"
              ? 0
              : 50,
    browserResolvedCount,
    missingBrowserResolvedNodeIds,
    runtimeReceiptsCompared: fontReceipts.length,
    mismatches,
    notes: [
      missingBrowserResolvedNodeIds.length
        ? "browser-resolved font data is incomplete in the snapshot."
        : "all text nodes include browser-resolved font metadata.",
      !fontReceipts.length
        ? phase === "live_acceptance"
          ? "figma runtime font receipts are missing from live acceptance."
          : "figma runtime font receipts have not been compared yet."
        : mismatches.length
          ? "one or more figma text nodes fell back away from the browser-resolved font."
          : "figma text receipts match the browser-resolved font family and style.",
    ],
  };

  const visualDiffScore =
    params.visualDiff?.score !== undefined
      ? params.visualDiff.score
      : params.visualDiff?.compositeScore !== undefined
        ? Math.round((1 - params.visualDiff.compositeScore) * 1000) / 10
        : null;
  const visualDiffGates = [...(params.visualDiff?.acceptanceGates || [])];
  const visualDiffHardFailed = visualDiffGates.some((gate) => gate.hard && !gate.passed);
  const visualDiffComposite = params.visualDiff?.compositeScore ?? null;
  const visualDiffHasMetrics =
    visualDiffScore !== null || visualDiffComposite !== null || visualDiffGates.length > 0;
  const visualDiff: CodeToDesignVisualDiffAssessment = params.visualDiff
    ? {
        status:
          (!visualDiffHasMetrics && phase === "live_acceptance") ||
          visualDiffHardFailed ||
          (visualDiffComposite !== null && visualDiffComposite < 0.9) ||
          (visualDiffScore !== null && visualDiffScore > 5)
            ? "fail"
            : "pass",
        score: visualDiffScore,
        compositeScore: visualDiffComposite,
        artifactPaths: [...(params.visualDiff.artifactPaths || [])],
        acceptanceGates: visualDiffGates,
        hotspots: [...(params.visualDiff.hotspots || [])],
        notes: [...(params.visualDiff.notes || [])],
      }
    : {
        status: phase === "live_acceptance" ? "fail" : "pending",
        score: null,
        compositeScore: null,
        artifactPaths: [],
        acceptanceGates: [],
        hotspots: [],
        notes: [
          phase === "live_acceptance"
            ? "visual diff artifacts are missing from live acceptance."
            : "visual diff has not been executed yet.",
        ],
      };

  const requiredViewportKeys = uniqueStrings(
    params.responsive?.requiredViewportKeys || listResponsiveVariants(params.snapshot).map((variant) => variant.viewportKey),
  );
  const responsiveProbes = [...(params.responsive?.probes || [])];
  const observedViewportKeys = uniqueStrings(responsiveProbes.map((probe) => probe.viewportKey));
  const missingViewportKeys = requiredViewportKeys.filter((viewportKey) => !observedViewportKeys.includes(viewportKey));
  const responsiveStatus: CodeToDesignGateStatus =
    !responsiveProbes.length && phase !== "live_acceptance"
      ? "pending"
      : missingViewportKeys.length || responsiveProbes.some((probe) => probe.status !== "pass")
      ? "fail"
      : responsiveProbes.length
        ? "pass"
        : phase === "live_acceptance"
          ? "fail"
          : "pending";
  const responsiveScore =
    responsiveProbes.length
      ? Math.round(
          responsiveProbes.reduce((total, probe) => total + (probe.score ?? 0), 0) / responsiveProbes.length,
        )
      : phase === "live_acceptance"
        ? 0
        : null;
  const responsive: CodeToDesignResponsiveAssessment = {
    status: responsiveStatus,
    score: responsiveScore,
    requiredViewportKeys,
    observedViewportKeys,
    probes: responsiveProbes,
    notes: [
      missingViewportKeys.length
        ? `missing responsive probes: ${missingViewportKeys.join(", ")}`
        : "all required responsive probes were evaluated.",
      ...responsiveProbes.flatMap((probe) => probe.notes),
    ],
  };

  return {
    kind: "code_to_design_quality_report",
    version: "v4",
    phase,
    route: params.snapshot.route,
    pageTitle: params.snapshot.page.title,
    overallStatus: determineOverallStatus([
      structure.status,
      naming.status,
      figmaTree.status,
      fontInstall.status,
      fontEnvironment.status,
      fontAlignment.status,
      visualDiff.status,
      responsive.status,
    ]),
    structure,
    naming,
    figmaTree,
    fontInstall,
    fontEnvironment,
    fontAlignment,
    visualDiff,
    responsive,
    warnings: uniqueStrings([
      ...structure.notes,
      ...naming.notes,
      ...figmaTree.notes,
      ...fontInstall.notes,
      ...fontEnvironment.notes,
      ...fontAlignment.notes,
      ...visualDiff.notes,
      ...responsive.notes,
    ]),
  };
}
