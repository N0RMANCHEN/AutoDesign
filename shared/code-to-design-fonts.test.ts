import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCodeToDesignFontInstallAssessment,
  collectCodeToDesignFontRequirements,
  normalizeCodeToDesignSnapshotFonts,
  syncCodeToDesignFontBundle,
} from "./code-to-design-fonts.js";
import { buildCodeToDesignRuntimeSnapshot } from "./code-to-design-snapshot.js";

function createSnapshot() {
  return buildCodeToDesignRuntimeSnapshot({
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
    nodes: [
      {
        id: "headline",
        parentId: "copy",
        domPath: "body > div > h1",
        tagName: "H1",
        className: "spread-headline",
        role: "text",
        name: "Headline",
        visible: true,
        rect: { x: 0, y: 0, width: 320, height: 120 },
        textContent: "Shadow Of Elegance",
        fontFamilyCandidates: ["Didot", "Times New Roman"],
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
          fontFamily: "Didot, Times New Roman, serif",
          fontStyle: "normal",
          fontSize: "80px",
          fontWeight: "600",
          lineHeight: "84px",
          letterSpacing: "-4px",
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
    responsiveVariants: [
      {
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
        nodes: [
          {
            id: "headline",
            parentId: "copy",
            domPath: "body > div > h1",
            tagName: "H1",
            className: "spread-headline",
            role: "text",
            name: "Headline",
            visible: true,
            rect: { x: 0, y: 0, width: 320, height: 120 },
            textContent: "Shadow Of Elegance",
            fontFamilyCandidates: ["Didot", "Times New Roman"],
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
              fontFamily: "Didot, Times New Roman, serif",
              fontStyle: "normal",
              fontSize: "80px",
              fontWeight: "600",
              lineHeight: "84px",
              letterSpacing: "-4px",
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
      },
      {
        viewportKey: "mobile",
        viewport: { width: 760, height: 2200, deviceScaleFactor: 1 },
        page: {
          title: "AItest",
          urlPath: "/",
          scrollWidth: 760,
          scrollHeight: 2400,
          backgroundColor: "rgb(245, 242, 236)",
          backgroundImage: "none",
        },
        nodes: [
          {
            id: "headline-mobile",
            parentId: "copy",
            domPath: "body > div > h1",
            tagName: "H1",
            className: "spread-headline",
            role: "text",
            name: "Headline",
            visible: true,
            rect: { x: 0, y: 0, width: 280, height: 140 },
            textContent: "Shadow Of Elegance",
            fontFamilyCandidates: ["Didot", "Times New Roman"],
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
              fontFamily: "Didot, Times New Roman, serif",
              fontStyle: "normal",
              fontSize: "64px",
              fontWeight: "600",
              lineHeight: "68px",
              letterSpacing: "-4px",
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
      },
    ],
  });
}

test("collectCodeToDesignFontRequirements deduplicates across responsive probes", () => {
  const snapshot = createSnapshot();
  const { requiredFonts, missingBrowserResolvedNodeIds } = collectCodeToDesignFontRequirements(snapshot);
  assert.equal(missingBrowserResolvedNodeIds.length, 0);
  assert.equal(requiredFonts.length, 1);
  assert.equal(requiredFonts[0]?.family, "Didot");
  assert.deepEqual(requiredFonts[0]?.viewportKeys, ["desktop", "mobile"]);
});

test("buildCodeToDesignFontInstallAssessment validates manifest coverage and installs fonts idempotently", async () => {
  const snapshot = createSnapshot();
  const bundleRoot = await mkdtemp(path.join(os.tmpdir(), "autodesign-font-bundle-"));
  await mkdir(path.join(bundleRoot, "didot"), { recursive: true });
  const sourceFontPath = path.join(bundleRoot, "didot", "Didot-Semibold.otf");
  await writeFile(sourceFontPath, "fake-font");
  await writeFile(
    path.join(bundleRoot, "manifest.json"),
    `${JSON.stringify(
      {
        kind: "code_to_design_font_manifest",
        version: "v1",
        fonts: [
          {
            family: "Didot",
            style: "Semibold",
            postscriptName: "Didot-Semibold",
            file: "didot/Didot-Semibold.otf",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-font-target-"));

  const first = await buildCodeToDesignFontInstallAssessment({
    snapshot,
    bundleRoot,
    install: true,
    targetDir,
  });
  assert.equal(first.status, "pass");
  assert.equal(first.installedFiles.length, 1);

  const second = await buildCodeToDesignFontInstallAssessment({
    snapshot,
    bundleRoot,
    install: true,
    targetDir,
  });
  assert.equal(second.status, "pass");
  assert.equal(second.installedFiles.length, 0);
  assert.equal(second.skippedFiles.length, 1);
});

test("buildCodeToDesignFontInstallAssessment installs split face files when manifest points to a font collection", async () => {
  const snapshot = createSnapshot();
  const bundleRoot = await mkdtemp(path.join(os.tmpdir(), "autodesign-font-collection-bundle-"));
  await mkdir(path.join(bundleRoot, "didot"), { recursive: true });
  const collectionPath = path.join(bundleRoot, "didot", "Didot.ttc");
  await writeFile(collectionPath, "fake-font-collection");
  await writeFile(
    path.join(bundleRoot, "manifest.json"),
    `${JSON.stringify(
      {
        kind: "code_to_design_font_manifest",
        version: "v1",
        fonts: [
          {
            family: "Didot",
            style: "Semibold",
            figmaStyle: "Bold",
            styleAliases: ["Semibold", "Bold"],
            postscriptName: "Didot-Bold",
            file: "didot/Didot.ttc",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  const splitterScriptPath = path.join(bundleRoot, "splitter.py");
  await writeFile(
    splitterScriptPath,
    [
      "import json",
      "import os",
      "import sys",
      "from pathlib import Path",
      "output_dir = Path(sys.argv[2])",
      "output_dir.mkdir(parents=True, exist_ok=True)",
      "target = output_dir / 'Didot-Bold.ttf'",
      "target.write_text('split-face', encoding='utf8')",
      "print(json.dumps({'faces': [{'family': 'Didot', 'style': 'Bold', 'postscriptName': 'Didot-Bold', 'filePath': str(target)}]}))",
    ].join("\n"),
    "utf8",
  );
  const previousSplitter = process.env.AUTODESIGN_FONT_COLLECTION_SPLITTER;
  process.env.AUTODESIGN_FONT_COLLECTION_SPLITTER = splitterScriptPath;

  try {
    const targetDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-font-collection-target-"));
    const report = await buildCodeToDesignFontInstallAssessment({
      snapshot,
      bundleRoot,
      install: true,
      targetDir,
    });

    assert.equal(report.status, "pass");
    assert.equal(report.installedFiles.length, 1);
    assert.match(report.installedFiles[0] || "", /Didot-Bold\.ttf$/);
    assert.equal(report.skippedFiles.length, 0);
    assert.equal(report.resolvedFonts[0]?.usedSplitFace, true);
    assert.equal(report.resolvedFonts[0]?.installTargetBasename, "Didot-Bold.ttf");
    assert.equal(report.resolvedFonts[0]?.splitFaces.length, 1);
  } finally {
    if (previousSplitter === undefined) {
      delete process.env.AUTODESIGN_FONT_COLLECTION_SPLITTER;
    } else {
      process.env.AUTODESIGN_FONT_COLLECTION_SPLITTER = previousSplitter;
    }
  }
});

test("buildCodeToDesignFontInstallAssessment prefers standalone face files when manifest already points to them", async () => {
  const snapshot = createSnapshot();
  const bundleRoot = await mkdtemp(path.join(os.tmpdir(), "autodesign-font-standalone-bundle-"));
  await mkdir(path.join(bundleRoot, "didot"), { recursive: true });
  const standalonePath = path.join(bundleRoot, "didot", "Didot-Bold.ttf");
  await writeFile(standalonePath, "standalone-face");
  await writeFile(
    path.join(bundleRoot, "manifest.json"),
    `${JSON.stringify(
      {
        kind: "code_to_design_font_manifest",
        version: "v1",
        fonts: [
          {
            family: "Didot",
            style: "Semibold",
            figmaStyle: "Bold",
            styleAliases: ["Semibold", "Bold"],
            postscriptName: "Didot-Bold",
            file: "didot/Didot-Bold.ttf",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  const splitterScriptPath = path.join(bundleRoot, "splitter.py");
  await writeFile(
    splitterScriptPath,
    [
      "raise SystemExit('splitter should not be called for standalone faces')",
    ].join("\n"),
    "utf8",
  );
  const previousSplitter = process.env.AUTODESIGN_FONT_COLLECTION_SPLITTER;
  process.env.AUTODESIGN_FONT_COLLECTION_SPLITTER = splitterScriptPath;

  try {
    const targetDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-font-standalone-target-"));
    const report = await buildCodeToDesignFontInstallAssessment({
      snapshot,
      bundleRoot,
      install: true,
      targetDir,
    });

    assert.equal(report.status, "pass");
    assert.equal(report.installedFiles.length, 1);
    assert.match(report.installedFiles[0] || "", /Didot-Bold\.ttf$/);
    assert.equal(report.resolvedFonts[0]?.usedSplitFace, false);
    assert.equal(report.resolvedFonts[0]?.installSourcePath, standalonePath);
    assert.equal(report.resolvedFonts[0]?.splitFaces.length, 0);
  } finally {
    if (previousSplitter === undefined) {
      delete process.env.AUTODESIGN_FONT_COLLECTION_SPLITTER;
    } else {
      process.env.AUTODESIGN_FONT_COLLECTION_SPLITTER = previousSplitter;
    }
  }
});

test("normalizeCodeToDesignSnapshotFonts applies manifest figma style aliases to browser font targets", () => {
  const snapshot = createSnapshot();
  const normalized = normalizeCodeToDesignSnapshotFonts(snapshot, {
    kind: "code_to_design_font_manifest",
    version: "v1",
    fonts: [
      {
        family: "Didot",
        style: "Semibold",
        figmaStyle: "Bold",
        styleAliases: ["Semibold", "Bold"],
        postscriptName: "Didot-Bold",
        file: "didot/Didot.ttc",
      },
    ],
  });

  assert.match(normalized.notes[0] || "", /Semibold -> Didot\/Bold/);
  assert.equal(normalized.snapshot.nodes[0]?.resolvedBrowserFontStyle, "Bold");
  assert.equal(
    normalized.snapshot.responsiveVariants[0]?.nodes[0]?.resolvedBrowserFontStyle,
    "Bold",
  );
  assert.equal(
    normalized.snapshot.responsiveVariants[1]?.nodes[0]?.resolvedBrowserFontStyle,
    "Bold",
  );
});

test("syncCodeToDesignFontBundle copies discovered website fonts into the licensed bundle and updates manifest", async () => {
  const snapshot = createSnapshot();
  const bundleRoot = await mkdtemp(path.join(os.tmpdir(), "autodesign-font-sync-bundle-"));
  const distRoot = await mkdtemp(path.join(os.tmpdir(), "autodesign-font-sync-dist-"));
  const sourceFontPath = path.join(distRoot, "Didot-Semibold.otf");
  await writeFile(sourceFontPath, "fake-font-from-site");

  const report = await syncCodeToDesignFontBundle({
    snapshot,
    bundleRoot,
    distRoot,
  });

  assert.equal(report.status, "pass");
  assert.equal(report.unresolvedEntries.length, 0);
  assert.equal(report.syncedEntries.length, 1);
  assert.equal(report.syncedEntries[0]?.sourceKind, "web_asset");
  assert.equal(report.syncedEntries[0]?.file, "didot/Didot-Semibold.otf");

  const manifestRaw = await readFile(path.join(bundleRoot, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestRaw) as {
    fonts: Array<{
      family: string;
      style: string;
      file: string;
      postscriptName: string;
      sha256?: string;
    }>;
  };
  assert.equal(manifest.fonts.length, 1);
  assert.equal(manifest.fonts[0]?.family, "Didot");
  assert.equal(manifest.fonts[0]?.style, "Semibold");
  assert.equal(manifest.fonts[0]?.file, "didot/Didot-Semibold.otf");
  assert.equal(manifest.fonts[0]?.postscriptName, "Didot-Semibold");
  assert.ok(manifest.fonts[0]?.sha256);
});
