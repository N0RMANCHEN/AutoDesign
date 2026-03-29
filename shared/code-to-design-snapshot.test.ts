import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCodeToDesignRuntimeSnapshot,
  combineResponsiveCodeToDesignSnapshots,
  collectRenderableNodes,
  getResponsiveVariantSnapshot,
} from "./code-to-design-snapshot.js";

test("buildCodeToDesignRuntimeSnapshot normalizes ordering and summary counts", () => {
  const snapshot = buildCodeToDesignRuntimeSnapshot({
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
      title: "AItest",
      urlPath: "/",
      scrollWidth: 1440,
      scrollHeight: 2200,
      backgroundColor: "rgb(245, 242, 236)",
      backgroundImage: "none",
    },
    nodes: [
      {
        id: "shape-1",
        parentId: null,
        domPath: "body>div",
        tagName: "DIV",
        className: "print-editorial-page",
        role: "shape",
        name: "Page",
        visible: true,
        rect: { x: 0, y: 100, width: 1440, height: 2000 },
        textContent: null,
        styles: {
          display: "block",
          position: "static",
          color: "rgb(0, 0, 0)",
          opacity: 1,
          backgroundColor: "rgb(255, 255, 255)",
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
          fontFamily: "Arial",
          fontSize: "16px",
          fontWeight: "400",
          lineHeight: "normal",
          letterSpacing: "normal",
          textAlign: "left",
          textTransform: "none",
          objectFit: "fill",
          gridTemplateColumns: "none",
          gridTemplateRows: "none",
          gap: "normal",
          rowGap: "normal",
          columnGap: "normal",
        },
        image: null,
      },
      {
        id: "text-1",
        parentId: "shape-1",
        domPath: "body>div>h1",
        tagName: "H1",
        className: "spread-headline",
        role: "text",
        name: "Headline",
        visible: true,
        rect: { x: 40, y: 20, width: 320, height: 80 },
        textContent: "Hello",
        fontFamilyCandidates: ["Didot", "Bodoni 72", "Times New Roman"],
        resolvedBrowserFontFamily: "Didot",
        resolvedBrowserFontStyle: "Semibold",
        styles: {
          display: "block",
          position: "static",
          color: "rgb(0, 0, 0)",
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
          fontFamily: "Didot",
          fontStyle: "normal",
          fontSize: "48px",
          fontWeight: "600",
          lineHeight: "52px",
          letterSpacing: "-2px",
          textAlign: "left",
          textTransform: "uppercase",
          objectFit: "fill",
          gridTemplateColumns: "none",
          gridTemplateRows: "none",
          gap: "normal",
          rowGap: "normal",
          columnGap: "normal",
        },
        image: null,
      },
    ],
    warnings: ["fonts need verification"],
  });

  assert.equal(snapshot.summary.nodeCount, 2);
  assert.equal(snapshot.version, "v2");
  assert.equal(snapshot.viewportKey, "desktop");
  assert.equal(snapshot.responsiveVariants.length, 1);
  assert.equal(snapshot.summary.textNodeCount, 1);
  assert.equal(snapshot.summary.shapeNodeCount, 1);
  assert.equal(snapshot.nodes[0].id, "text-1");
  assert.deepEqual(snapshot.nodes[0].fontFamilyCandidates, ["Didot", "Bodoni 72", "Times New Roman"]);
  assert.equal(snapshot.nodes[0].resolvedBrowserFontFamily, "Didot");
  assert.deepEqual(collectRenderableNodes(snapshot).map((node) => node.id), ["text-1", "shape-1"]);
});

test("combineResponsiveCodeToDesignSnapshots preserves per-viewport variants", () => {
  const desktop = buildCodeToDesignRuntimeSnapshot({
    route: "/",
    viewportKey: "desktop",
    viewport: { width: 1496, height: 2200, deviceScaleFactor: 1 },
    page: {
      title: "AItest",
      urlPath: "/",
      scrollWidth: 1496,
      scrollHeight: 2200,
      backgroundColor: "rgb(245, 242, 236)",
      backgroundImage: "none",
    },
    nodes: [],
  });
  const mobile = buildCodeToDesignRuntimeSnapshot({
    route: "/",
    viewportKey: "mobile",
    viewport: { width: 760, height: 2200, deviceScaleFactor: 1 },
    page: {
      title: "AItest",
      urlPath: "/",
      scrollWidth: 760,
      scrollHeight: 2500,
      backgroundColor: "rgb(245, 242, 236)",
      backgroundImage: "none",
    },
    nodes: [],
  });

  const combined = combineResponsiveCodeToDesignSnapshots({
    primaryViewportKey: "desktop",
    snapshots: [desktop, mobile],
  });

  assert.equal(combined.viewportKey, "desktop");
  assert.equal(combined.responsiveVariants.length, 2);
  assert.equal(getResponsiveVariantSnapshot(combined, "mobile")?.viewport.width, 760);
});
