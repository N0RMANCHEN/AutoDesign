import { access, copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDirectory = path.resolve(__dirname, "..");

const pluginPackages = [
  {
    directory: "plugins/codex-to-figma-smoke",
    entryFile: "src/main.ts",
  },
  {
    directory: "plugins/codex-to-figma",
    entryFile: "src/main.ts",
    uiFile: "src/ui.html",
  },
];

async function fileExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch (error) {
    return false;
  }
}

async function copyDirectoryContents(sourceDirectory, targetDirectory) {
  if (!(await fileExists(sourceDirectory))) {
    return;
  }

  await mkdir(targetDirectory, { recursive: true });
  const entries = await readdir(sourceDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDirectory, entry.name);
    const targetPath = path.join(targetDirectory, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryContents(sourcePath, targetPath);
      continue;
    }

    await copyFile(sourcePath, targetPath);
  }
}

async function buildPluginPackage(pluginPackage) {
  const packageDirectory = path.join(rootDirectory, pluginPackage.directory);
  const distDirectory = path.join(packageDirectory, "dist");
  const manifestTemplatePath = path.join(packageDirectory, "manifest.template.json");
  const mainEntryPath = path.join(packageDirectory, pluginPackage.entryFile);
  const manifest = JSON.parse(await readFile(manifestTemplatePath, "utf8"));

  await rm(distDirectory, { recursive: true, force: true });
  await mkdir(distDirectory, { recursive: true });

  await esbuild.build({
    entryPoints: [mainEntryPath],
    outfile: path.join(distDirectory, "code.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    charset: "utf8",
    legalComments: "none",
    target: ["es2017"],
  });

  const distManifest = {
    ...manifest,
    main: "code.js",
  };

  if (pluginPackage.uiFile) {
    const uiSourcePath = path.join(packageDirectory, pluginPackage.uiFile);
    if (await fileExists(uiSourcePath)) {
      await copyFile(uiSourcePath, path.join(distDirectory, "ui.html"));
      distManifest.ui = "ui.html";
    }
  }

  await copyDirectoryContents(path.join(packageDirectory, "assets"), distDirectory);

  await writeFile(
    path.join(distDirectory, "manifest.json"),
    JSON.stringify(distManifest, null, 2) + "\n",
    "utf8",
  );
}

for (const pluginPackage of pluginPackages) {
  await buildPluginPackage(pluginPackage);
}
