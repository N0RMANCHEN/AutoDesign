import assert from "node:assert/strict";
import test from "node:test";

import { buildCodeToDesignRuntimeSnapshot } from "./code-to-design-snapshot.js";
import { buildCodeToDesignQualityReport } from "./code-to-design-quality.js";
import type { CodeToDesignLayoutNode } from "./code-to-design-plan.js";
import type { PluginNodeInspection } from "./plugin-bridge.js";
import type { CodeToDesignFontInstallAssessment } from "./code-to-design-fonts.js";

const baseStyle = {
  display: "block",
  position: "static",
  color: "rgb(15, 15, 15)",
  opacity: 1,
  backgroundColor: "rgba(0, 0, 0, 0)",
  backgroundImage: "none",
  borderTopWidth: "0px",
  borderRightWidth: "0px",
  borderBottomWidth: "0px",
  borderLeftWidth: "0px",
  borderTopColor: "rgba(0, 0, 0, 0)",
  borderRightColor: "rgba(0, 0, 0, 0)",
  borderBottomColor: "rgba(0, 0, 0, 0)",
  borderLeftColor: "rgba(0, 0, 0, 0)",
  borderTopLeftRadius: "0px",
  borderTopRightRadius: "0px",
  borderBottomRightRadius: "0px",
  borderBottomLeftRadius: "0px",
  fontFamily: "Helvetica Neue",
  fontStyle: "normal",
  fontSize: "16px",
  fontWeight: "400",
  lineHeight: "24px",
  letterSpacing: "0px",
  textAlign: "left",
  textTransform: "none",
  objectFit: "fill",
  gridTemplateColumns: "none",
  gridTemplateRows: "none",
  gap: "normal",
  rowGap: "normal",
  columnGap: "normal",
};

function createSnapshot() {
  return buildCodeToDesignRuntimeSnapshot({
    projectRoot: "/tmp/aitest",
    projectName: "aitest",
    route: "/",
    entryPaths: ["src/App.tsx"],
    viewport: {
      width: 1440,
      height: 2200,
      deviceScaleFactor: 1,
    },
    page: {
      title: "Shadow Of Elegance",
      urlPath: "/",
      scrollWidth: 1440,
      scrollHeight: 2200,
      backgroundColor: "rgb(245, 242, 236)",
      backgroundImage: "none",
    },
    nodes: [
      {
        id: "headline",
        parentId: "copy",
        domPath: "body > div > h1",
        tagName: "H1",
        role: "text",
        name: "H1",
        visible: true,
        rect: { x: 40, y: 30, width: 320, height: 120 },
        textContent: "Shadow Of Elegance",
        fontFamilyCandidates: ["Didot", "Times New Roman"],
        resolvedBrowserFontFamily: "Didot",
        resolvedBrowserFontStyle: "Regular",
        styles: {
          ...baseStyle,
          fontFamily: "Didot, Times New Roman, serif",
          fontSize: "64px",
          lineHeight: "68px",
        },
        image: null,
      },
    ],
  });
}

function createLayoutTree(): CodeToDesignLayoutNode {
  return {
    id: "page-root",
    kind: "frame",
    name: "Shadow Of Elegance",
    rect: { x: 0, y: 0, width: 1440, height: 2200 },
    parentId: null,
    sourceNodeIds: [],
    children: [
      {
        id: "opening-copy",
        kind: "frame",
        name: "Opening Copy",
        rect: { x: 40, y: 30, width: 320, height: 120 },
        parentId: "page-root",
        sourceNodeIds: ["copy"],
        children: [
          {
            id: "headline",
            kind: "text",
            name: "Headline",
            rect: { x: 40, y: 30, width: 320, height: 120 },
            parentId: "opening-copy",
            sourceNodeIds: ["headline"],
            children: [],
            textContent: "Shadow Of Elegance",
            textStyle: {
              fontFamily: "Didot",
              fontFamilyCandidates: ["Didot", "Times New Roman"],
              fontStyle: "Regular",
              fontSize: 64,
              fontWeight: 400,
              alignment: "left",
              textAutoResize: "HEIGHT",
              resolvedBrowserFontFamily: "Didot",
              resolvedBrowserFontStyle: "Regular",
            },
          },
        ],
        layout: {
          mode: "VERTICAL",
          itemSpacing: 12,
          primaryAxisSizingMode: "FIXED",
          counterAxisSizingMode: "FIXED",
          primaryAxisAlignItems: "MIN",
          counterAxisAlignItems: "MIN",
        },
      },
    ],
  };
}

function createInspectedNodes(): PluginNodeInspection[] {
  return [
    {
      id: "1:1",
      name: "Shadow Of Elegance",
      type: "FRAME",
      fillable: true,
      fills: ["#FFFFFF"],
      fillStyleId: null,
      x: 0,
      y: 0,
      absoluteX: 0,
      absoluteY: 0,
      width: 1440,
      height: 2200,
      parentNodeId: "0:1",
      parentNodeType: "PAGE",
      parentLayoutMode: "NONE",
      layoutMode: "NONE",
      layoutPositioning: "AUTO",
      depth: 0,
      childCount: 1,
      indexWithinParent: 0,
      analysisRefId: "code-to-design:page-root",
      visible: true,
      locked: false,
      opacity: 1,
      rotation: 0,
      strokes: [],
      strokeStyleId: null,
      cornerRadius: 0,
      clipsContent: true,
      isMask: false,
      maskType: null,
      constraintsHorizontal: "MIN",
      constraintsVertical: "MIN",
      layoutGrow: 0,
      layoutAlign: "INHERIT",
      layoutSizingHorizontal: "FIXED",
      layoutSizingVertical: "FIXED",
      primaryAxisSizingMode: null,
      counterAxisSizingMode: null,
      primaryAxisAlignItems: null,
      counterAxisAlignItems: null,
      itemSpacing: null,
      paddingLeft: null,
      paddingRight: null,
      paddingTop: null,
      paddingBottom: null,
      textContent: null,
      fontFamily: null,
      fontStyle: null,
      fontSize: null,
      fontWeight: null,
      lineHeight: null,
      letterSpacing: null,
      textAlignment: null,
      textAutoResize: null,
      mainComponentId: null,
      mainComponentName: null,
      componentPropertyReferences: [],
      componentPropertyDefinitionKeys: [],
      variantProperties: {},
      generatedBy: null,
    },
    {
      id: "1:2",
      name: "Opening Copy",
      type: "FRAME",
      fillable: true,
      fills: ["#FFFFFF"],
      fillStyleId: null,
      x: 40,
      y: 30,
      absoluteX: 40,
      absoluteY: 30,
      width: 320,
      height: 120,
      parentNodeId: "1:1",
      parentNodeType: "FRAME",
      parentLayoutMode: "NONE",
      layoutMode: "VERTICAL",
      layoutPositioning: "AUTO",
      depth: 1,
      childCount: 1,
      indexWithinParent: 0,
      analysisRefId: "code-to-design:layout:opening-copy",
      visible: true,
      locked: false,
      opacity: 1,
      rotation: 0,
      strokes: [],
      strokeStyleId: null,
      cornerRadius: 0,
      clipsContent: true,
      isMask: false,
      maskType: null,
      constraintsHorizontal: "MIN",
      constraintsVertical: "MIN",
      layoutGrow: 0,
      layoutAlign: "INHERIT",
      layoutSizingHorizontal: "FIXED",
      layoutSizingVertical: "FIXED",
      primaryAxisSizingMode: "FIXED",
      counterAxisSizingMode: "FIXED",
      primaryAxisAlignItems: "MIN",
      counterAxisAlignItems: "MIN",
      itemSpacing: 12,
      paddingLeft: 0,
      paddingRight: 0,
      paddingTop: 0,
      paddingBottom: 0,
      textContent: null,
      fontFamily: null,
      fontStyle: null,
      fontSize: null,
      fontWeight: null,
      lineHeight: null,
      letterSpacing: null,
      textAlignment: null,
      textAutoResize: null,
      mainComponentId: null,
      mainComponentName: null,
      componentPropertyReferences: [],
      componentPropertyDefinitionKeys: [],
      variantProperties: {},
      generatedBy: null,
    },
    {
      id: "1:3",
      name: "Headline",
      type: "TEXT",
      fillable: true,
      fills: ["#111111"],
      fillStyleId: null,
      x: 0,
      y: 0,
      absoluteX: 40,
      absoluteY: 30,
      width: 320,
      height: 120,
      parentNodeId: "1:2",
      parentNodeType: "FRAME",
      parentLayoutMode: "VERTICAL",
      layoutMode: null,
      layoutPositioning: "AUTO",
      depth: 2,
      childCount: 0,
      indexWithinParent: 0,
      analysisRefId: "code-to-design:layout:headline",
      visible: true,
      locked: false,
      opacity: 1,
      rotation: 0,
      strokes: [],
      strokeStyleId: null,
      cornerRadius: null,
      clipsContent: null,
      isMask: false,
      maskType: null,
      constraintsHorizontal: "MIN",
      constraintsVertical: "MIN",
      layoutGrow: 0,
      layoutAlign: "INHERIT",
      layoutSizingHorizontal: "FIXED",
      layoutSizingVertical: "HUG",
      primaryAxisSizingMode: null,
      counterAxisSizingMode: null,
      primaryAxisAlignItems: null,
      counterAxisAlignItems: null,
      itemSpacing: null,
      paddingLeft: null,
      paddingRight: null,
      paddingTop: null,
      paddingBottom: null,
      textContent: "Shadow Of Elegance",
      fontFamily: "Didot",
      fontStyle: "Regular",
      fontSize: 64,
      fontWeight: 400,
      lineHeight: 68,
      letterSpacing: 0,
      textAlignment: "LEFT",
      textAutoResize: "HEIGHT",
      mainComponentId: null,
      mainComponentName: null,
      componentPropertyReferences: [],
      componentPropertyDefinitionKeys: [],
      variantProperties: {},
      generatedBy: null,
    },
  ];
}

function createFontInstallAssessment(
  overrides?: Partial<CodeToDesignFontInstallAssessment>,
): CodeToDesignFontInstallAssessment {
  return {
    status: "pass",
    manifestPath: "assets/fonts/licensed/manifest.json",
    bundleRoot: "assets/fonts/licensed",
    targetDir: "/Users/test/Library/Fonts",
    installAttempted: true,
    requiredFonts: [
      {
        family: "Didot",
        style: "Regular",
        viewportKeys: ["desktop"],
        sourceNodeIds: ["headline"],
      },
    ],
    missingBrowserResolvedNodeIds: [],
    missingManifestEntries: [],
    missingFiles: [],
    autoResolvedEntries: [],
    resolvedFonts: [
      {
        requestedFamily: "Didot",
        requestedStyle: "Regular",
        figmaFamily: "Didot",
        figmaStyle: "Regular",
        manifestFile: "didot/Didot.ttf",
        manifestPostscriptName: "Didot",
        sourcePath: "assets/fonts/licensed/didot/Didot.ttf",
        sourceKind: "bundle_manifest",
        installSourcePath: "assets/fonts/licensed/didot/Didot.ttf",
        installTargetBasename: "Didot.ttf",
        installTargetPath: "/Users/test/Library/Fonts/Didot.ttf",
        usedSplitFace: false,
        splitSourcePath: null,
        splitError: null,
        splitFaces: [],
      },
    ],
    installedFiles: [],
    skippedFiles: ["Didot-Regular.otf"],
    notes: ["font bundle covers all browser-resolved families/styles."],
    ...(overrides || {}),
  };
}

test("buildCodeToDesignQualityReport keeps preflight-only gates pending before live artifacts exist", () => {
  const report = buildCodeToDesignQualityReport({
    snapshot: createSnapshot(),
    layoutTree: createLayoutTree(),
    requiredContainerNames: ["Opening Copy"],
    phase: "preflight",
  });

  assert.equal(report.version, "v4");
  assert.equal(report.phase, "preflight");
  assert.equal(report.structure.status, "pass");
  assert.equal(report.naming.status, "pass");
  assert.equal(report.figmaTree.status, "pending");
  assert.equal(report.fontInstall.status, "pending");
  assert.equal(report.fontEnvironment.status, "pending");
  assert.equal(report.fontAlignment.status, "pending");
  assert.equal(report.visualDiff.status, "pending");
  assert.equal(report.responsive.status, "pending");
  assert.equal(report.overallStatus, "pending");
});

test("buildCodeToDesignQualityReport passes live acceptance when figma tree, fonts and diff all line up", () => {
  const report = buildCodeToDesignQualityReport({
    snapshot: createSnapshot(),
    layoutTree: createLayoutTree(),
    requiredContainerNames: ["Opening Copy"],
    phase: "live_acceptance",
    fontInstall: createFontInstallAssessment(),
    fontCatalog: [
      {
        family: "Didot",
        style: "Regular",
        familyKey: "didot",
        styleKey: "regular",
      },
    ],
    inspectedNodes: createInspectedNodes(),
    runtimeResults: [
      {
        capabilityId: "nodes.create-text",
        ok: true,
        changedNodeIds: ["1:3"],
        createdStyleIds: [],
        createdVariableIds: [],
        exportedImages: [],
        inspectedNodes: [],
        warnings: [],
        errorCode: null,
        message: "ok",
        createdNodeReceipts: [
          {
            nodeId: "1:3",
            nodeType: "TEXT",
            name: "Headline",
            analysisRefId: "code-to-design:layout:headline",
            parentNodeId: "1:2",
            fontResolution: {
              requestedFamilies: ["Didot"],
              requestedStyles: ["Regular"],
              browserResolvedFamily: "Didot",
              browserResolvedStyle: "Regular",
              figmaResolvedFamily: "Didot",
              figmaResolvedStyle: "Regular",
              fallbackOccurred: false,
              deviatesFromBrowser: false,
            },
          },
        ],
      },
    ],
    visualDiff: {
      compositeScore: 0.95,
      score: 5,
      artifactPaths: ["reports/acceptance/artifacts/code-to-design/browser-vs-figma.png"],
      acceptanceGates: [
        {
          id: "gate-global",
          label: "Global similarity",
          metric: "globalSimilarity",
          comparator: "gte",
          threshold: 0.9,
          actual: 0.95,
          passed: true,
          hard: true,
        },
      ],
      notes: ["visual diff passes all hard gates."],
    },
    responsive: {
      requiredViewportKeys: ["desktop"],
      probes: [
        {
          viewportKey: "desktop",
          status: "pass",
          score: 97,
          figmaTreeStatus: "pass",
          visualDiffStatus: "pass",
          compositeScore: 0.95,
          artifactPaths: ["reports/acceptance/artifacts/code-to-design/browser-vs-figma.png"],
          notes: ["desktop probe passes."],
        },
      ],
    },
  });

  assert.equal(report.phase, "live_acceptance");
  assert.equal(report.figmaTree.status, "pass");
  assert.equal(report.fontInstall.status, "pass");
  assert.equal(report.fontEnvironment.status, "pass");
  assert.equal(report.fontAlignment.status, "pass");
  assert.equal(report.visualDiff.status, "pass");
  assert.equal(report.responsive.status, "pass");
  assert.equal(report.overallStatus, "pass");
});

test("buildCodeToDesignQualityReport fails live acceptance when required live artifacts are missing or mismatched", () => {
  const badInspectedNodes = createInspectedNodes().map((node) =>
    node.analysisRefId === "code-to-design:layout:headline"
      ? { ...node, textAutoResize: "NONE" }
      : node,
  );

  const report = buildCodeToDesignQualityReport({
    snapshot: createSnapshot(),
    layoutTree: createLayoutTree(),
    requiredContainerNames: ["Opening Copy"],
    phase: "live_acceptance",
    fontInstall: createFontInstallAssessment(),
    inspectedNodes: badInspectedNodes,
  });

  assert.equal(report.figmaTree.status, "fail");
  assert.equal(report.fontAlignment.status, "fail");
  assert.equal(report.visualDiff.status, "fail");
  assert.equal(report.responsive.status, "fail");
  assert.equal(report.overallStatus, "fail");
});
