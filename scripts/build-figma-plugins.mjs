import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDirectory = path.resolve(__dirname, "..");

const pluginPackages = [
  {
    directory: "plugins/autodesign-smoke",
    entryFile: "src/main.ts",
  },
  {
    directory: "plugins/autodesign",
    entryFile: "src/main.ts",
    uiFile: "src/ui.html",
  },
];

async function fileExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
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
  let banner = undefined;

  await rm(distDirectory, { recursive: true, force: true });
  await mkdir(distDirectory, { recursive: true });

  if (pluginPackage.uiFile) {
    const uiSourcePath = path.join(packageDirectory, pluginPackage.uiFile);
    if (await fileExists(uiSourcePath)) {
      await validatePluginUiLock(packageDirectory, pluginPackage.uiFile);
      banner = {
        js: `const __html__ = ${JSON.stringify(await readFile(uiSourcePath, "utf8"))};`,
      };
    }
  }

  await esbuild.build({
    entryPoints: [mainEntryPath],
    outfile: path.join(distDirectory, "code.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    charset: "utf8",
    legalComments: "none",
    target: ["es2017"],
    banner,
  });

  const distManifest = {
    ...manifest,
    main: "code.js",
  };

  if (pluginPackage.uiFile) {
    const uiSourcePath = path.join(packageDirectory, pluginPackage.uiFile);
    if (await fileExists(uiSourcePath)) {
      await copyFile(uiSourcePath, path.join(distDirectory, "ui.html"));
      // NOTE: Do NOT set distManifest.ui here.
      // __html__ is already injected via esbuild banner (line 68).
      // Setting manifest.ui causes Figma to also inject __html__,
      // resulting in "Identifier '__html__' has already been declared".
    }
  }

  await copyDirectoryContents(path.join(packageDirectory, "assets"), distDirectory);

  await writeFile(
    path.join(distDirectory, "manifest.json"),
    JSON.stringify(distManifest, null, 2) + "\n",
    "utf8",
  );

  await validatePluginBuild(pluginPackage, distDirectory, distManifest);
}

async function validatePluginBuild(pluginPackage, distDirectory, distManifest) {
  const manifestPath = path.join(distDirectory, "manifest.json");
  const codePath = path.join(distDirectory, "code.js");

  ensure(await fileExists(manifestPath), `${pluginPackage.directory}: dist manifest missing.`);
  ensure(await fileExists(codePath), `${pluginPackage.directory}: code bundle missing.`);
  ensure(distManifest.main === "code.js", `${pluginPackage.directory}: manifest.main must be code.js.`);

  const code = await readFile(codePath, "utf8");
  ensure(code.includes("figma.showUI(") || !pluginPackage.uiFile, `${pluginPackage.directory}: showUI call missing.`);

  if (!pluginPackage.uiFile) {
    return;
  }

  const uiPath = path.join(distDirectory, "ui.html");
  ensure(await fileExists(uiPath), `${pluginPackage.directory}: ui.html missing from dist.`);
  ensure(!("ui" in distManifest), `${pluginPackage.directory}: manifest.ui must stay unset when HTML is injected.`);

  const hasInjectedUi =
    code.includes("figma.showUI(__html__") ||
    (code.includes("figma.showUI(") && code.includes("<!doctype html>"));
  ensure(hasInjectedUi, `${pluginPackage.directory}: showUI HTML injection missing.`);
}

async function validatePluginUiLock(packageDirectory, uiFile) {
  const lockPath = path.join(packageDirectory, "ui.lock.json");
  if (!(await fileExists(lockPath))) {
    return;
  }

  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const sourcePath = path.join(packageDirectory, lock.source || uiFile);
  const actualHash = sha256(await readFile(sourcePath, "utf8"));

  ensure(
    actualHash === lock.sha256,
    `${packageDirectory}: plugin UI is locked. ${lock.source || uiFile} changed without an explicit UI update approval.`,
  );
}

for (const pluginPackage of pluginPackages) {
  await buildPluginPackage(pluginPackage);
}
