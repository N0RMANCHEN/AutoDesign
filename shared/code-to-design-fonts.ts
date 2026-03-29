import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCodeToDesignRuntimeSnapshot,
  listResponsiveVariants,
  type CodeToDesignRuntimeSnapshot,
} from "./code-to-design-snapshot.js";

export type CodeToDesignFontManifestEntry = {
  family: string;
  style: string;
  postscriptName: string;
  file: string;
  sha256?: string;
  aliases?: string[];
  figmaFamily?: string;
  figmaStyle?: string;
  styleAliases?: string[];
};

export type CodeToDesignFontManifest = {
  kind: "code_to_design_font_manifest";
  version: "v1";
  fonts: CodeToDesignFontManifestEntry[];
};

export type CodeToDesignFontRequirement = {
  family: string;
  style: string | null;
  viewportKeys: string[];
  sourceNodeIds: string[];
};

export type CodeToDesignSplitFontFace = {
  family: string;
  style: string;
  postscriptName: string;
  filePath: string;
};

export type CodeToDesignResolvedFontEntry = {
  requestedFamily: string;
  requestedStyle: string | null;
  figmaFamily: string;
  figmaStyle: string | null;
  manifestFile: string | null;
  manifestPostscriptName: string | null;
  sourcePath: string | null;
  sourceKind: "bundle_manifest" | "web_asset" | "system_font" | null;
  installSourcePath: string | null;
  installTargetBasename: string | null;
  installTargetPath: string | null;
  usedSplitFace: boolean;
  splitSourcePath: string | null;
  splitError: string | null;
  splitFaces: CodeToDesignSplitFontFace[];
};

export type CodeToDesignFontInstallAssessment = {
  status: "pass" | "fail" | "pending";
  manifestPath: string;
  bundleRoot: string;
  targetDir: string | null;
  installAttempted: boolean;
  requiredFonts: CodeToDesignFontRequirement[];
  missingBrowserResolvedNodeIds: string[];
  missingManifestEntries: Array<{
    family: string;
    style: string | null;
  }>;
  missingFiles: string[];
  autoResolvedEntries: Array<{
    family: string;
    style: string | null;
    sourcePath: string;
    sourceKind: "web_asset" | "system_font";
  }>;
  resolvedFonts: CodeToDesignResolvedFontEntry[];
  installedFiles: string[];
  skippedFiles: string[];
  notes: string[];
};

export type CodeToDesignFontBundleSyncReport = {
  status: "pass" | "fail";
  bundleRoot: string;
  manifestPath: string;
  requiredFonts: CodeToDesignFontRequirement[];
  missingBrowserResolvedNodeIds: string[];
  unresolvedEntries: Array<{
    family: string;
    style: string | null;
  }>;
  syncedEntries: Array<{
    family: string;
    style: string | null;
    file: string;
    sourcePath: string;
    sourceKind: "web_asset" | "system_font" | "bundle_manifest";
    copied: boolean;
    manifestUpdated: boolean;
  }>;
  notes: string[];
};

type SplitFontCollectionResult = {
  faces: CodeToDesignSplitFontFace[];
  error: string | null;
};

const sharedDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(sharedDirectory, "..");
const defaultFontCollectionSplitterScriptPath = path.join(repoRoot, "scripts", "split-font-collection.py");

function normalizeKey(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeFontStyleKey(value: string | null | undefined) {
  const normalized = normalizeKey(value);
  if (!normalized || normalized === "regular" || normalized === "normal") {
    return "regular";
  }
  if (normalized === "semi bold") {
    return "semibold";
  }
  return normalized;
}

function isRegularEquivalentStyle(value: string | null | undefined) {
  const normalized = normalizeKey(value);
  return !normalized || normalized === "regular" || normalized === "normal" || normalized === "roman" || normalized === "book" || normalized === "plain";
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function isAbsolutePath(targetPath: string) {
  return path.isAbsolute(targetPath);
}

async function exists(targetPath: string) {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function computeSha256(targetPath: string) {
  const content = await readFile(targetPath);
  return createHash("sha256").update(content).digest("hex");
}

export function resolveCodeToDesignFontBundleRoot(explicitRoot?: string | null) {
  return path.resolve(explicitRoot || path.join(process.cwd(), "assets", "fonts", "licensed"));
}

export function resolveCodeToDesignFontManifestPath(bundleRoot: string) {
  return path.join(bundleRoot, "manifest.json");
}

function createEmptyFontManifest(): CodeToDesignFontManifest {
  return {
    kind: "code_to_design_font_manifest",
    version: "v1",
    fonts: [],
  };
}

export async function loadCodeToDesignFontManifest(bundleRoot: string) {
  const manifestPath = resolveCodeToDesignFontManifestPath(bundleRoot);
  const raw = await readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<CodeToDesignFontManifest>;
  if (parsed.kind !== "code_to_design_font_manifest" || parsed.version !== "v1" || !Array.isArray(parsed.fonts)) {
    throw new Error(`invalid font manifest: ${manifestPath}`);
  }
  return {
    manifestPath,
    manifest: parsed as CodeToDesignFontManifest,
  };
}

export function collectCodeToDesignFontRequirements(snapshot: CodeToDesignRuntimeSnapshot) {
  const requirements = new Map<string, CodeToDesignFontRequirement>();
  const missingBrowserResolvedNodeIds: string[] = [];
  for (const variant of listResponsiveVariants(snapshot)) {
    for (const node of variant.nodes) {
      if (node.role !== "text") {
        continue;
      }
      const family = node.resolvedBrowserFontFamily || null;
      const style = node.resolvedBrowserFontStyle || null;
      if (!family) {
        missingBrowserResolvedNodeIds.push(node.id);
        continue;
      }
      const requirementKey = `${normalizeKey(family)}::${normalizeFontStyleKey(style)}`;
      const existing = requirements.get(requirementKey);
      if (existing) {
        existing.viewportKeys = uniqueStrings([...existing.viewportKeys, variant.viewportKey]);
        existing.sourceNodeIds = uniqueStrings([...existing.sourceNodeIds, node.id]);
        continue;
      }
      requirements.set(requirementKey, {
        family,
        style,
        viewportKeys: [variant.viewportKey],
        sourceNodeIds: [node.id],
      });
    }
  }
  return {
    requiredFonts: [...requirements.values()].sort((left, right) =>
      `${left.family}/${left.style || ""}`.localeCompare(`${right.family}/${right.style || ""}`),
    ),
    missingBrowserResolvedNodeIds: uniqueStrings(missingBrowserResolvedNodeIds),
  };
}

function findManifestEntry(
  manifest: CodeToDesignFontManifest,
  requirement: CodeToDesignFontRequirement,
) {
  const familyKey = normalizeKey(requirement.family);
  const styleKey = normalizeFontStyleKey(requirement.style);
  return (
    manifest.fonts.find((entry) => {
      const familyMatches =
        normalizeKey(entry.family) === familyKey ||
        normalizeKey(entry.figmaFamily) === familyKey ||
        (entry.aliases || []).some((alias) => normalizeKey(alias) === familyKey);
      if (!familyMatches) {
        return false;
      }
      return (
        normalizeFontStyleKey(entry.style) === styleKey ||
        normalizeFontStyleKey(entry.figmaStyle) === styleKey ||
        (entry.styleAliases || []).some((alias) => normalizeFontStyleKey(alias) === styleKey)
      );
    }) || null
  );
}

type ScannedFontFace = {
  family: string;
  style: string;
  postscriptName: string | null;
};

function normalizeFcScanField(value: string) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)[0] || "";
}

function scanFontFaces(sourcePath: string): ScannedFontFace[] {
  const result = spawnSync(
    "fc-scan",
    [
      "--format",
      "%{family}\u001f%{style}\u001f%{postscriptname}\u001e",
      sourcePath,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  if (result.status !== 0 || !result.stdout) {
    return [];
  }

  return result.stdout
    .split("\u001e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [family, style, postscriptName] = record.split("\u001f");
      return {
        family: normalizeFcScanField(family || ""),
        style: normalizeFcScanField(style || ""),
        postscriptName: normalizeFcScanField(postscriptName || "") || null,
      } satisfies ScannedFontFace;
    })
    .filter((face) => face.family);
}

function isFontCollectionPath(sourcePath: string) {
  return /\.(ttc|otc)$/i.test(sourcePath);
}

function resolveFontCollectionSplitterScriptPath() {
  return path.resolve(
    process.env.AUTODESIGN_FONT_COLLECTION_SPLITTER || defaultFontCollectionSplitterScriptPath,
  );
}

function splitFontCollectionSource(
  sourcePath: string,
  outputDir: string,
): SplitFontCollectionResult {
  const env = { ...process.env };
  const bundledFontToolsPath = path.join(repoRoot, ".vendor", "fonttools");
  const pythonPaths = [process.env.PYTHONPATH || ""];
  if (!process.env.AUTODESIGN_FONT_COLLECTION_SPLITTER && path.isAbsolute(bundledFontToolsPath)) {
    pythonPaths.unshift(bundledFontToolsPath);
  }
  env.PYTHONPATH = pythonPaths.filter(Boolean).join(path.delimiter);

  const result = spawnSync(
    "python3",
    [resolveFontCollectionSplitterScriptPath(), sourcePath, outputDir],
    {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) {
    return {
      faces: [],
      error:
        result.stderr.trim() ||
        result.stdout.trim() ||
        `font collection split failed for ${path.basename(sourcePath)}`,
    };
  }

  try {
    const parsed = JSON.parse(result.stdout || "{}") as {
      faces?: Array<{
        family?: string;
        style?: string;
        postscriptName?: string;
        filePath?: string;
      }>;
    };
    return {
      faces: (parsed.faces || [])
        .map((face) => ({
          family: String(face.family || "").trim(),
          style: String(face.style || "").trim(),
          postscriptName: String(face.postscriptName || "").trim(),
          filePath: String(face.filePath || "").trim(),
        }))
        .filter((face) => face.family && face.style && face.postscriptName && face.filePath),
      error: null,
    };
  } catch (error) {
    return {
      faces: [],
      error:
        error instanceof Error
          ? error.message
          : `font collection split returned invalid JSON for ${path.basename(sourcePath)}`,
    };
  }
}

function chooseFigmaFaceForRequirement(
  requirement: CodeToDesignFontRequirement,
  faces: ScannedFontFace[],
) {
  const familyKey = normalizeKey(requirement.family);
  const sameFamily = faces.filter((face) => normalizeKey(face.family) === familyKey);
  if (!sameFamily.length) {
    return null;
  }

  const requestedStyleKey = normalizeFontStyleKey(requirement.style);
  const exact = sameFamily.find((face) => normalizeFontStyleKey(face.style) === requestedStyleKey) || null;
  if (exact) {
    return exact;
  }
  if (requestedStyleKey === "regular") {
    return sameFamily.find((face) => isRegularEquivalentStyle(face.style)) || null;
  }
  if (requestedStyleKey === "semibold") {
    return sameFamily.find((face) => normalizeFontStyleKey(face.style) === "semibold")
      || sameFamily.find((face) => normalizeFontStyleKey(face.style) === "bold")
      || sameFamily.find((face) => normalizeKey(face.style) === "demibold")
      || null;
  }
  return null;
}

function deriveManifestTargetFromSource(
  requirement: CodeToDesignFontRequirement,
  sourcePath: string,
) {
  const face = chooseFigmaFaceForRequirement(requirement, scanFontFaces(sourcePath));
  if (!face) {
    return null;
  }
  const styleAliases = uniqueStrings([requirement.style, face.style]);
  return {
    figmaFamily: face.family,
    figmaStyle: face.style,
    styleAliases,
    postscriptName: face.postscriptName || undefined,
  };
}

export function resolveCodeToDesignFontRequirement(
  manifest: CodeToDesignFontManifest | null,
  requirement: CodeToDesignFontRequirement,
) {
  const entry = manifest ? findManifestEntry(manifest, requirement) : null;
  const family = entry?.figmaFamily || entry?.family || requirement.family;
  const style = entry?.figmaStyle || requirement.style;
  return {
    requestedFamily: requirement.family,
    requestedStyle: requirement.style,
    family,
    style,
    manifestEntry: entry,
    normalized:
      normalizeKey(family) !== normalizeKey(requirement.family) ||
      normalizeKey(style) !== normalizeKey(requirement.style),
  };
}

export function normalizeCodeToDesignSnapshotFonts(
  snapshot: CodeToDesignRuntimeSnapshot,
  manifest: CodeToDesignFontManifest | null,
) {
  const notes: string[] = [];
  const normalizeNodes = (nodes: typeof snapshot.nodes) =>
    nodes.map((node) => {
      if (node.role !== "text" || !node.resolvedBrowserFontFamily) {
        return node;
      }
      const resolved = resolveCodeToDesignFontRequirement(manifest, {
        family: node.resolvedBrowserFontFamily,
        style: node.resolvedBrowserFontStyle || null,
        viewportKeys: [],
        sourceNodeIds: [node.id],
      });
      if (!resolved.normalized) {
        return node;
      }
      notes.push(
        `normalized browser font target for ${node.id}: ${node.resolvedBrowserFontFamily}/${node.resolvedBrowserFontStyle || "Regular"} -> ${resolved.family}/${resolved.style || "Regular"}`,
      );
      return {
        ...node,
        resolvedBrowserFontFamily: resolved.family,
        resolvedBrowserFontStyle: resolved.style,
      };
    });

  const responsiveVariants = listResponsiveVariants(snapshot).map((variant) => ({
    viewportKey: variant.viewportKey,
    viewport: variant.viewport,
    page: variant.page,
    nodes: normalizeNodes(variant.nodes),
  }));
  const primary = responsiveVariants.find((variant) => variant.viewportKey === snapshot.viewportKey) || responsiveVariants[0]!;

  return {
    snapshot: buildCodeToDesignRuntimeSnapshot({
      projectRoot: snapshot.projectRoot,
      projectName: snapshot.projectName,
      route: snapshot.route,
      entryPaths: snapshot.entryPaths,
      viewportKey: primary.viewportKey,
      viewport: primary.viewport,
      page: primary.page,
      nodes: primary.nodes,
      responsiveVariants,
      warnings: uniqueStrings([...snapshot.warnings, ...notes]),
    }),
    notes: uniqueStrings(notes),
  };
}

export function resolveDefaultCodeToDesignFontTargetDir() {
  const workspaceMatch = /^\/Users\/([^/]+)/.exec(process.cwd());
  if (workspaceMatch?.[1] && !os.homedir().includes("/.codex-accounts/")) {
    return path.join("/Users", workspaceMatch[1], "Library", "Fonts");
  }
  if (workspaceMatch?.[1] && os.homedir().includes("/.codex-accounts/")) {
    return path.join("/Users", workspaceMatch[1], "Library", "Fonts");
  }
  return path.join(os.homedir(), "Library", "Fonts");
}

function familySearchTokens(family: string) {
  const normalized = normalizeKey(family);
  const tokens = new Set<string>();
  if (normalized === "-apple-system" || normalized === "blinkmacsystemfont" || normalized === "system-ui") {
    tokens.add("sf-pro-display");
    tokens.add("sf pro display");
    tokens.add("sf-pro-text");
    tokens.add("sf pro text");
    tokens.add("sf-pro");
    tokens.add("sf pro");
  }
  tokens.add(normalized.replace(/\s+/g, " "));
  tokens.add(normalized.replace(/\s+/g, "-"));
  return [...tokens];
}

function styleSearchTokens(style: string | null) {
  const normalized = normalizeFontStyleKey(style);
  if (normalized === "regular") {
    return ["regular"];
  }
  if (normalized === "semibold" || normalized === "semi bold") {
    return ["semibold", "semi-bold", "semi bold", "semibd", "bold"];
  }
  if (normalized === "bold") {
    return ["bold"];
  }
  return [normalized];
}

function slugifyFontSegment(value: string) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "font";
}

function formatManifestStyle(style: string | null | undefined) {
  const normalized = normalizeFontStyleKey(style);
  if (normalized === "regular") {
    return "Regular";
  }
  if (normalized === "semibold") {
    return "Semibold";
  }
  if (normalized === "bold") {
    return "Bold";
  }
  if (normalized === "medium") {
    return "Medium";
  }
  if (normalized === "italic") {
    return "Italic";
  }
  if (normalized === "bolditalic") {
    return "Bold Italic";
  }
  return String(style || "Regular").trim() || "Regular";
}

function inferPostscriptName(
  requirement: CodeToDesignFontRequirement,
  sourcePath: string,
) {
  const basename = path.basename(sourcePath, path.extname(sourcePath)).trim();
  if (basename) {
    return basename.replace(/\s+/g, "-");
  }
  return `${requirement.family.replace(/\s+/g, "")}-${formatManifestStyle(requirement.style).replace(/\s+/g, "")}`;
}

function defaultBundleRelativeFontFile(
  requirement: CodeToDesignFontRequirement,
  sourcePath: string,
) {
  return path
    .join(slugifyFontSegment(requirement.family), path.basename(sourcePath))
    .replace(/\\/g, "/");
}

function sortManifestFonts(fonts: CodeToDesignFontManifestEntry[]) {
  return [...fonts].sort((left, right) =>
    `${normalizeKey(left.family)}::${normalizeFontStyleKey(left.style)}::${normalizeKey(left.file)}`.localeCompare(
      `${normalizeKey(right.family)}::${normalizeFontStyleKey(right.style)}::${normalizeKey(right.file)}`,
    ),
  );
}

function upsertManifestEntry(
  manifest: CodeToDesignFontManifest,
  nextEntry: CodeToDesignFontManifestEntry,
) {
  const index = manifest.fonts.findIndex(
    (entry) =>
      normalizeKey(entry.family) === normalizeKey(nextEntry.family) &&
      normalizeFontStyleKey(entry.style) === normalizeFontStyleKey(nextEntry.style),
  );
  if (index < 0) {
    manifest.fonts.push(nextEntry);
    manifest.fonts = sortManifestFonts(manifest.fonts);
    return true;
  }
  const previous = manifest.fonts[index]!;
  if (JSON.stringify(previous) === JSON.stringify(nextEntry)) {
    return false;
  }
  manifest.fonts[index] = nextEntry;
  manifest.fonts = sortManifestFonts(manifest.fonts);
  return true;
}

async function loadOrInitializeCodeToDesignFontManifest(bundleRoot: string) {
  const manifestPath = resolveCodeToDesignFontManifestPath(bundleRoot);
  const notes: string[] = [];
  if (!(await exists(manifestPath))) {
    notes.push("font manifest was missing and will be initialized.");
    return {
      manifestPath,
      manifest: createEmptyFontManifest(),
      notes,
    };
  }

  try {
    const loaded = await loadCodeToDesignFontManifest(bundleRoot);
    return {
      manifestPath: loaded.manifestPath,
      manifest: loaded.manifest,
      notes,
    };
  } catch (error) {
    notes.push(error instanceof Error ? error.message : "font manifest was invalid and will be reinitialized.");
    return {
      manifestPath,
      manifest: createEmptyFontManifest(),
      notes,
    };
  }
}

async function walkFiles(root: string, maxDepth = 3, depth = 0): Promise<string[]> {
  if (!(await exists(root)) || depth > maxDepth) {
    return [];
  }
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(entryPath, maxDepth, depth + 1)));
      continue;
    }
    if (!/\.(otf|ttf|ttc|woff2?|otc)$/i.test(entry.name)) {
      continue;
    }
    files.push(entryPath);
  }
  return files;
}

async function discoverFontSource(
  requirement: CodeToDesignFontRequirement,
  options: {
    projectRoot?: string | null;
    distRoot?: string | null;
  },
) {
  const roots: Array<{ root: string; kind: "web_asset" | "system_font" }> = [];
  if (options.distRoot) {
    roots.push({ root: path.resolve(options.distRoot), kind: "web_asset" });
  }
  if (options.projectRoot) {
    roots.push({ root: path.resolve(options.projectRoot, "public"), kind: "web_asset" });
    roots.push({ root: path.resolve(options.projectRoot, "assets"), kind: "web_asset" });
  }
  roots.push({ root: "/Library/Fonts", kind: "system_font" });
  roots.push({ root: "/System/Library/Fonts", kind: "system_font" });
  roots.push({ root: "/System/Library/Fonts/Supplemental", kind: "system_font" });
  roots.push({ root: path.join(resolveDefaultCodeToDesignFontTargetDir()), kind: "system_font" });

  const familyTokens = familySearchTokens(requirement.family);
  const styleTokens = styleSearchTokens(requirement.style);

  let bestMatch: { sourcePath: string; sourceKind: "web_asset" | "system_font"; score: number } | null = null;
  for (const { root, kind } of roots) {
    for (const filePath of await walkFiles(root)) {
      const basename = path.basename(filePath).toLowerCase();
      const familyMatched = familyTokens.some((token) => basename.includes(token));
      if (!familyMatched) {
        continue;
      }
      let score = kind === "web_asset" ? 30 : 20;
      score += familyTokens.find((token) => basename.includes(token))?.length || 0;
      const styleMatchIndex = styleTokens.findIndex((token) => basename.includes(token));
      if (styleMatchIndex >= 0) {
        score += 25 - styleMatchIndex * 3;
      } else if (/\.ttc$/i.test(basename)) {
        score += 5;
      } else if (requirement.style && normalizeKey(requirement.style) !== "regular") {
        continue;
      }
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          sourcePath: filePath,
          sourceKind: kind,
          score,
        };
      }
    }
  }
  return bestMatch
    ? {
        family: requirement.family,
        style: requirement.style,
        sourcePath: bestMatch.sourcePath,
        sourceKind: bestMatch.sourceKind,
      }
    : null;
}

export async function syncCodeToDesignFontBundle(params: {
  snapshot: CodeToDesignRuntimeSnapshot;
  bundleRoot?: string | null;
  projectRoot?: string | null;
  distRoot?: string | null;
}) {
  const bundleRoot = resolveCodeToDesignFontBundleRoot(params.bundleRoot);
  await mkdir(bundleRoot, { recursive: true });

  const { manifestPath, manifest, notes } = await loadOrInitializeCodeToDesignFontManifest(bundleRoot);
  const { requiredFonts, missingBrowserResolvedNodeIds } = collectCodeToDesignFontRequirements(params.snapshot);
  const unresolvedEntries: Array<{ family: string; style: string | null }> = [];
  const syncedEntries: CodeToDesignFontBundleSyncReport["syncedEntries"] = [];
  let manifestChanged = false;

  for (const requirement of requiredFonts) {
    const existingEntry = findManifestEntry(manifest, requirement);
    if (existingEntry && !isAbsolutePath(existingEntry.file)) {
      const existingBundlePath = path.resolve(bundleRoot, existingEntry.file);
      if (await exists(existingBundlePath)) {
        const sha256 = existingEntry.sha256 || (await computeSha256(existingBundlePath));
        const detectedTarget = deriveManifestTargetFromSource(requirement, existingBundlePath);
        const nextEntry = {
          ...existingEntry,
          style: formatManifestStyle(existingEntry.style),
          sha256,
          ...(detectedTarget?.figmaFamily ? { figmaFamily: detectedTarget.figmaFamily } : {}),
          ...(detectedTarget?.figmaStyle ? { figmaStyle: detectedTarget.figmaStyle } : {}),
          ...(detectedTarget?.styleAliases?.length ? { styleAliases: detectedTarget.styleAliases } : {}),
          ...(detectedTarget?.postscriptName ? { postscriptName: detectedTarget.postscriptName } : {}),
        } satisfies CodeToDesignFontManifestEntry;
        const manifestUpdated = upsertManifestEntry(manifest, nextEntry);
        manifestChanged ||= manifestUpdated;
        syncedEntries.push({
          family: requirement.family,
          style: requirement.style,
          file: nextEntry.file,
          sourcePath: existingBundlePath,
          sourceKind: "bundle_manifest",
          copied: false,
          manifestUpdated,
        });
        continue;
      }
    }

    const discovered = await discoverFontSource(requirement, {
      projectRoot: params.projectRoot,
      distRoot: params.distRoot,
    });
    if (!discovered) {
      unresolvedEntries.push({
        family: requirement.family,
        style: requirement.style,
      });
      continue;
    }

    const relativeFile =
      existingEntry && !isAbsolutePath(existingEntry.file)
        ? existingEntry.file.replace(/\\/g, "/")
        : defaultBundleRelativeFontFile(requirement, discovered.sourcePath);
    const bundleFilePath = path.resolve(bundleRoot, relativeFile);
    await mkdir(path.dirname(bundleFilePath), { recursive: true });

    const sourceSha256 = await computeSha256(discovered.sourcePath);
    let copied = false;
    if (!(await exists(bundleFilePath))) {
      await copyFile(discovered.sourcePath, bundleFilePath);
      copied = true;
    } else {
      const existingSha256 = await computeSha256(bundleFilePath);
      if (existingSha256 !== sourceSha256) {
        await copyFile(discovered.sourcePath, bundleFilePath);
        copied = true;
      }
    }

    const detectedTarget = deriveManifestTargetFromSource(requirement, discovered.sourcePath);
    const nextEntry = {
      family: requirement.family,
      style: formatManifestStyle(requirement.style),
      postscriptName: detectedTarget?.postscriptName || inferPostscriptName(requirement, discovered.sourcePath),
      file: relativeFile,
      sha256: sourceSha256,
      ...(detectedTarget?.figmaFamily ? { figmaFamily: detectedTarget.figmaFamily } : {}),
      ...(detectedTarget?.figmaStyle ? { figmaStyle: detectedTarget.figmaStyle } : {}),
      ...(detectedTarget?.styleAliases?.length ? { styleAliases: detectedTarget.styleAliases } : {}),
    } satisfies CodeToDesignFontManifestEntry;
    const manifestUpdated = upsertManifestEntry(manifest, nextEntry);
    manifestChanged ||= manifestUpdated;
    syncedEntries.push({
      family: requirement.family,
      style: requirement.style,
      file: relativeFile,
      sourcePath: discovered.sourcePath,
      sourceKind: discovered.sourceKind,
      copied,
      manifestUpdated,
    });
  }

  if (manifestChanged || !(await exists(manifestPath))) {
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          ...manifest,
          fonts: sortManifestFonts(manifest.fonts),
        } satisfies CodeToDesignFontManifest,
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  if (missingBrowserResolvedNodeIds.length) {
    notes.push("browser-resolved font data is incomplete in the snapshot.");
  }
  if (syncedEntries.some((entry) => entry.sourceKind === "web_asset")) {
    notes.push("synced one or more font files directly from website assets into the licensed bundle.");
  }
  if (syncedEntries.some((entry) => entry.sourceKind === "system_font")) {
    notes.push("website assets did not include all required font binaries; synced browser-resolved local fonts into the licensed bundle.");
  }
  if (unresolvedEntries.length) {
    notes.push("one or more required fonts could not be synced into the licensed bundle.");
  }

  return {
    status: missingBrowserResolvedNodeIds.length || unresolvedEntries.length ? "fail" : "pass",
    bundleRoot,
    manifestPath,
    requiredFonts,
    missingBrowserResolvedNodeIds,
    unresolvedEntries,
    syncedEntries,
    notes,
  } satisfies CodeToDesignFontBundleSyncReport;
}

async function resolveInstallableFontSource(params: {
  requirement: CodeToDesignFontRequirement;
  entry: CodeToDesignFontManifestEntry | null;
  sourcePath: string;
  targetDir: string;
  splitCache: Map<string, SplitFontCollectionResult>;
  notes: string[];
}) {
  if (!isFontCollectionPath(params.sourcePath)) {
    return {
      sourcePath: params.sourcePath,
      targetBasename: params.entry
        ? path.basename(params.entry.file)
        : path.basename(params.sourcePath),
      sourceHash: params.entry?.sha256 || (await computeSha256(params.sourcePath)),
      usedSplitFace: false,
      splitSourcePath: null,
      splitError: null,
      splitFaces: [] as CodeToDesignSplitFontFace[],
    };
  }

  const cacheKey = path.resolve(params.sourcePath);
  let splitResult = params.splitCache.get(cacheKey);
  if (!splitResult) {
    const splitOutputDir = path.join(
      params.targetDir,
      ".autodesign-split-cache",
      slugifyFontSegment(path.basename(params.sourcePath, path.extname(params.sourcePath))),
    );
    await mkdir(splitOutputDir, { recursive: true });
    splitResult = splitFontCollectionSource(params.sourcePath, splitOutputDir);
    params.splitCache.set(cacheKey, splitResult);
    if (splitResult.error) {
      params.notes.push(
        `font collection split failed for ${path.basename(params.sourcePath)}; falling back to installing the collection file (${splitResult.error}).`,
      );
    } else {
      params.notes.push(
        `split font collection ${path.basename(params.sourcePath)} into standalone face files before install.`,
      );
    }
  }

  if (splitResult.error || !splitResult.faces.length) {
    return {
      sourcePath: params.sourcePath,
      targetBasename: params.entry
        ? path.basename(params.entry.file)
        : path.basename(params.sourcePath),
      sourceHash: params.entry?.sha256 || (await computeSha256(params.sourcePath)),
      usedSplitFace: false,
      splitSourcePath: params.sourcePath,
      splitError: splitResult.error,
      splitFaces: splitResult.faces,
    };
  }

  const exactPostscriptMatch =
    params.entry?.postscriptName
      ? splitResult.faces.find(
          (face) => normalizeKey(face.postscriptName) === normalizeKey(params.entry?.postscriptName),
        ) || null
      : null;
  const chosenFace =
    exactPostscriptMatch ||
    chooseFigmaFaceForRequirement(
      params.requirement,
      splitResult.faces.map((face) => ({
        family: face.family,
        style: face.style,
        postscriptName: face.postscriptName,
      })),
    );
  const selectedFace = chosenFace
    ? splitResult.faces.find(
        (face) => normalizeKey(face.postscriptName) === normalizeKey(chosenFace.postscriptName),
      ) || null
    : null;
  if (!selectedFace || !(await exists(selectedFace.filePath))) {
    params.notes.push(
      `font collection split did not produce a matching face for ${params.requirement.family}/${params.requirement.style || "Regular"}; falling back to the collection file.`,
    );
    return {
      sourcePath: params.sourcePath,
      targetBasename: params.entry
        ? path.basename(params.entry.file)
        : path.basename(params.sourcePath),
      sourceHash: params.entry?.sha256 || (await computeSha256(params.sourcePath)),
      usedSplitFace: false,
      splitSourcePath: params.sourcePath,
      splitError: null,
      splitFaces: splitResult.faces,
    };
  }

  return {
    sourcePath: selectedFace.filePath,
    targetBasename: path.basename(selectedFace.filePath),
    sourceHash: await computeSha256(selectedFace.filePath),
    usedSplitFace: true,
    splitSourcePath: params.sourcePath,
    splitError: null,
    splitFaces: splitResult.faces,
  };
}

export async function buildCodeToDesignFontInstallAssessment(params: {
  snapshot: CodeToDesignRuntimeSnapshot;
  bundleRoot?: string | null;
  projectRoot?: string | null;
  distRoot?: string | null;
  install?: boolean;
  targetDir?: string | null;
}) {
  const bundleRoot = resolveCodeToDesignFontBundleRoot(params.bundleRoot);
  const targetDir = params.install ? path.resolve(params.targetDir || resolveDefaultCodeToDesignFontTargetDir()) : null;
  const { requiredFonts, missingBrowserResolvedNodeIds } = collectCodeToDesignFontRequirements(params.snapshot);
  const installedFiles: string[] = [];
  const skippedFiles: string[] = [];
  const missingManifestEntries: Array<{ family: string; style: string | null }> = [];
  const missingFiles: string[] = [];
  const autoResolvedEntries: Array<{
    family: string;
    style: string | null;
    sourcePath: string;
    sourceKind: "web_asset" | "system_font";
  }> = [];
  const notes: string[] = [];
  const splitCache = new Map<string, SplitFontCollectionResult>();

  let manifestPath = resolveCodeToDesignFontManifestPath(bundleRoot);
  let manifest: CodeToDesignFontManifest | null = null;
  try {
    const loaded = await loadCodeToDesignFontManifest(bundleRoot);
    manifestPath = loaded.manifestPath;
    manifest = loaded.manifest;
  } catch (error) {
    notes.push(error instanceof Error ? error.message : "font manifest could not be loaded");
  }

  const resolvedEntries: Array<{
    requirement: CodeToDesignFontRequirement;
    entry: CodeToDesignFontManifestEntry | null;
    sourcePath: string | null;
    sourceKind: "bundle_manifest" | "web_asset" | "system_font" | null;
  }> = requiredFonts.map((requirement) => {
    const entry = manifest ? findManifestEntry(manifest, requirement) : null;
    if (!entry) {
      return {
        requirement,
        entry: null,
        sourcePath: null,
        sourceKind: null,
      };
    }
    const sourcePath = isAbsolutePath(entry.file) ? entry.file : path.resolve(bundleRoot, entry.file);
    return {
      requirement,
      entry,
      sourcePath,
      sourceKind: "bundle_manifest" as const,
    };
  });

  for (const resolved of resolvedEntries) {
    if (resolved.entry || resolved.sourcePath) {
      continue;
    }
    const discovered = await discoverFontSource(resolved.requirement, {
      projectRoot: params.projectRoot,
      distRoot: params.distRoot,
    });
    if (discovered) {
      resolved.sourcePath = discovered.sourcePath;
      resolved.sourceKind = discovered.sourceKind;
      autoResolvedEntries.push(discovered);
      continue;
    }
    missingManifestEntries.push({
      family: resolved.requirement.family,
      style: resolved.requirement.style,
    });
  }

  for (const resolved of resolvedEntries) {
    if (!resolved.sourcePath) {
      continue;
    }
    if (!(await exists(resolved.sourcePath))) {
      missingFiles.push(resolved.sourcePath);
    }
  }

  const resolvedFonts: CodeToDesignResolvedFontEntry[] = resolvedEntries.map((resolved) => {
    const target = resolveCodeToDesignFontRequirement(manifest, resolved.requirement);
    return {
      requestedFamily: resolved.requirement.family,
      requestedStyle: resolved.requirement.style,
      figmaFamily: target.family,
      figmaStyle: target.style,
      manifestFile: resolved.entry?.file || null,
      manifestPostscriptName: resolved.entry?.postscriptName || null,
      sourcePath: resolved.sourcePath,
      sourceKind: resolved.sourceKind,
      installSourcePath: null,
      installTargetBasename: null,
      installTargetPath: null,
      usedSplitFace: false,
      splitSourcePath: isFontCollectionPath(resolved.sourcePath || "") ? resolved.sourcePath : null,
      splitError: null,
      splitFaces: [],
    };
  });

  if (
    params.install &&
    !missingBrowserResolvedNodeIds.length &&
    !missingManifestEntries.length &&
    !missingFiles.length &&
    targetDir
  ) {
    await mkdir(targetDir, { recursive: true });
    for (const resolved of resolvedEntries) {
      if (!resolved.sourcePath) {
        continue;
      }
      const installSource = await resolveInstallableFontSource({
        requirement: resolved.requirement,
        entry: resolved.entry,
        sourcePath: resolved.sourcePath,
        targetDir,
        splitCache,
        notes,
      });
      const targetPath = path.join(targetDir, installSource.targetBasename);
      const resolvedFont = resolvedFonts.find(
        (entry) =>
          normalizeKey(entry.requestedFamily) === normalizeKey(resolved.requirement.family) &&
          normalizeFontStyleKey(entry.requestedStyle) === normalizeFontStyleKey(resolved.requirement.style),
      );
      if (resolvedFont) {
        resolvedFont.installSourcePath = installSource.sourcePath;
        resolvedFont.installTargetBasename = installSource.targetBasename;
        resolvedFont.installTargetPath = targetPath;
        resolvedFont.usedSplitFace = installSource.usedSplitFace;
        resolvedFont.splitSourcePath = installSource.splitSourcePath;
        resolvedFont.splitError = installSource.splitError;
        resolvedFont.splitFaces = installSource.splitFaces;
      }
      const sourceHash = installSource.sourceHash;
      if (await exists(targetPath)) {
        const targetHash = await computeSha256(targetPath);
        if (targetHash === sourceHash) {
          skippedFiles.push(targetPath);
          continue;
        }
      }
      await copyFile(installSource.sourcePath, targetPath);
      installedFiles.push(targetPath);
    }
  }

  if (missingBrowserResolvedNodeIds.length) {
    notes.push("browser-resolved font data is incomplete in the snapshot.");
  } else {
    notes.push("browser-resolved font data is available for all text nodes across responsive probes.");
  }
  if (missingManifestEntries.length) {
    notes.push("font manifest and automatic discovery could not resolve one or more browser-resolved font families/styles.");
  } else if (autoResolvedEntries.length) {
    notes.push("resolved missing font entries automatically from website assets or local system fonts.");
  }
  if (missingFiles.length) {
    notes.push("font bundle is missing one or more declared font files.");
  }
  if (params.install) {
    notes.push(
      installedFiles.length
        ? `installed ${installedFiles.length} font file(s) into ${targetDir}.`
        : `font install step completed without new copies into ${targetDir}.`,
    );
  }

  return {
    status:
      missingBrowserResolvedNodeIds.length || missingManifestEntries.length || missingFiles.length
        ? "fail"
        : "pass",
    manifestPath,
    bundleRoot,
    targetDir,
    installAttempted: Boolean(params.install),
    requiredFonts,
    missingBrowserResolvedNodeIds,
    missingManifestEntries,
    missingFiles,
    autoResolvedEntries,
    resolvedFonts,
    installedFiles,
    skippedFiles,
    notes,
  } satisfies CodeToDesignFontInstallAssessment;
}
