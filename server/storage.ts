import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { seededProject } from "../shared/seed.js";
import type { ProjectData } from "../shared/types.js";
import { nowIso } from "../shared/utils.js";
import { resolveDataDirectory } from "./runtime-paths.js";

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
  return JSON.parse(raw) as ProjectData;
}

export async function writeProject(data: ProjectData): Promise<ProjectData> {
  await ensureDataFile();
  const { projectFile } = resolveProjectPaths();
  const nextData: ProjectData = {
    ...data,
    meta: {
      ...data.meta,
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
