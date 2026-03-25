import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { seededProject } from "../shared/seed.js";
import { mappingEvidenceKinds, type ProjectData } from "../shared/types.js";
import { nowIso } from "../shared/utils.js";
import { resolveDataDirectory } from "./runtime-paths.js";

function normalizeComponentMappingImplementationTarget(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as {
    packageName?: unknown;
    path?: unknown;
    exportName?: unknown;
  };
  const path = typeof record.path === "string" ? record.path.trim() : "";
  const exportName = typeof record.exportName === "string" ? record.exportName.trim() : "";
  const packageName = typeof record.packageName === "string" ? record.packageName.trim() : "";

  if (!path || !exportName) {
    return null;
  }

  return {
    packageName: packageName || null,
    path,
    exportName,
  };
}

function normalizeComponentMappingEvidence(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const record = item as {
      kind?: unknown;
      label?: unknown;
      href?: unknown;
    };
    const kind = typeof record.kind === "string" ? record.kind.trim() : "";
    const label = typeof record.label === "string" ? record.label.trim() : "";
    const href = typeof record.href === "string" ? record.href.trim() : "";

    if (!mappingEvidenceKinds.includes(kind as (typeof mappingEvidenceKinds)[number])) {
      return [];
    }

    if (!label || !href) {
      return [];
    }

    return [{
      kind: kind as (typeof mappingEvidenceKinds)[number],
      label,
      href,
    }];
  });
}

function normalizeProjectData(raw: unknown): ProjectData {
  const value = raw as Partial<ProjectData> & {
    meta?: Partial<ProjectData["meta"]>;
  };

  return {
    meta: {
      ...seededProject.meta,
      ...(value.meta ?? {}),
    },
    designSources: Array.isArray(value.designSources) ? value.designSources : [],
    designScreens: Array.isArray(value.designScreens) ? value.designScreens : [],
    componentMappings: Array.isArray(value.componentMappings)
      ? value.componentMappings.map((item) => ({
          ...item,
          implementationTarget: normalizeComponentMappingImplementationTarget(
            (item as { implementationTarget?: unknown }).implementationTarget,
          ),
          evidence: normalizeComponentMappingEvidence(
            (item as { evidence?: unknown }).evidence,
          ),
        }))
      : [],
    reviewItems: Array.isArray(value.reviewItems) ? value.reviewItems : [],
    libraryAssets: Array.isArray(value.libraryAssets) ? value.libraryAssets : [],
    runtimeSessions: Array.isArray(value.runtimeSessions) ? value.runtimeSessions : [],
  };
}

function resolveProjectPaths() {
  const dataDirectory = resolveDataDirectory();
  return {
    dataDirectory,
    projectFile: path.join(dataDirectory, "autodesign-project.json"),
    legacyProjectFile: path.join(dataDirectory, "figmatest-project.json"),
  };
}

async function ensureDataFile() {
  const { dataDirectory, projectFile, legacyProjectFile } = resolveProjectPaths();
  await mkdir(dataDirectory, { recursive: true });

  try {
    await readFile(projectFile, "utf8");
  } catch {
    try {
      const legacy = await readFile(legacyProjectFile, "utf8");
      await writeFile(projectFile, legacy, "utf8");
    } catch {
      await writeFile(projectFile, JSON.stringify(seededProject, null, 2), "utf8");
    }
  }
}

export async function readProject(): Promise<ProjectData> {
  await ensureDataFile();
  const { projectFile } = resolveProjectPaths();
  const raw = await readFile(projectFile, "utf8");
  return normalizeProjectData(JSON.parse(raw));
}

export async function writeProject(data: ProjectData): Promise<ProjectData> {
  await ensureDataFile();
  const { projectFile } = resolveProjectPaths();
  const normalized = normalizeProjectData(data);
  const nextData: ProjectData = {
    ...normalized,
    meta: {
      ...normalized.meta,
      updatedAt: nowIso(),
    },
  };
  await writeFile(projectFile, JSON.stringify(nextData, null, 2), "utf8");
  return nextData;
}

export async function resetProject(): Promise<ProjectData> {
  await ensureDataFile();
  const { projectFile } = resolveProjectPaths();
  await writeFile(projectFile, JSON.stringify(seededProject, null, 2), "utf8");
  return seededProject;
}
