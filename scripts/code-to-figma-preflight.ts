import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  formatCodeToFigmaPreflightReport,
  runCodeToFigmaPreflight,
  type CodeToFigmaFileKind,
  type CodeToFigmaSourceFile,
} from "../shared/code-to-figma-preflight.js";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "backend",
  "coverage",
  "dist",
  "dist-server",
  "node_modules",
  "server",
]);

const CSS_EXTENSIONS = new Set([".css", ".less", ".pcss", ".sass", ".scss"]);
const SCRIPT_EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);

function fail(message: string): never {
  throw new Error(message);
}

function usage() {
  return [
    "Usage:",
    "  npm run code-to-figma:preflight -- --project ../AItest",
    "  npm run code-to-figma:preflight -- --project ../AItest --entry src/App.tsx --allow-blocked --format json",
    "  npm run code-to-figma:preflight -- --project ../AItest --entry src/App.tsx --out data/code-to-figma-preflight.json",
  ].join("\n");
}

function readFlag(argv: string[], name: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function readFlags(argv: string[], name: string) {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== name) {
      continue;
    }
    const value = argv[index + 1] ?? null;
    if (value && !value.startsWith("--")) {
      values.push(value);
    }
  }
  return values;
}

function hasFlag(argv: string[], name: string) {
  return argv.includes(name);
}

function readRequiredFlag(argv: string[], name: string) {
  const value = readFlag(argv, name);
  if (!value || value.startsWith("--")) {
    fail(`${name} is required\n\n${usage()}`);
  }
  return value;
}

function normalizeRepoPath(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function resolveFileKind(filePath: string): CodeToFigmaFileKind | null {
  const extension = path.extname(filePath).toLowerCase();
  if (CSS_EXTENSIONS.has(extension)) {
    return "css";
  }
  if (SCRIPT_EXTENSIONS.has(extension)) {
    return "script";
  }
  return null;
}

async function walkProjectDirectory(rootDirectory: string) {
  const files: string[] = [];
  const entries = await readdir(rootDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      files.push(...(await walkProjectDirectory(path.join(rootDirectory, entry.name))));
      continue;
    }
    files.push(path.join(rootDirectory, entry.name));
  }
  return files;
}

async function pathExists(targetPath: string) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readProjectName(projectRoot: string) {
  try {
    const packageJsonPath = path.join(projectRoot, "package.json");
    const raw = await readFile(packageJsonPath, "utf8");
    const payload = JSON.parse(raw) as { name?: string };
    return typeof payload.name === "string" ? payload.name : null;
  } catch {
    return null;
  }
}

async function resolveSourceRoots(projectRoot: string, explicitRoots: string[]) {
  if (explicitRoots.length > 0) {
    return explicitRoots.map((rootPath) => path.resolve(projectRoot, rootPath));
  }

  const candidateRoots = ["src", "app", "pages", "components", "styles", "client", "frontend", "web"];
  const detectedRoots: string[] = [];
  for (const candidateRoot of candidateRoots) {
    const absoluteCandidateRoot = path.join(projectRoot, candidateRoot);
    if (await pathExists(absoluteCandidateRoot)) {
      detectedRoots.push(absoluteCandidateRoot);
    }
  }

  if (detectedRoots.length > 0) {
    return detectedRoots;
  }

  return [projectRoot];
}

async function collectSourceFiles(projectRoot: string, explicitRoots: string[]) {
  const sourceRoots = await resolveSourceRoots(projectRoot, explicitRoots);
  const absoluteFiles = uniqueAbsolutePaths(
    (await Promise.all(sourceRoots.map((sourceRoot) => walkProjectDirectory(sourceRoot)))).flat(),
  );
  const sourceFiles: CodeToFigmaSourceFile[] = [];
  for (const absoluteFilePath of absoluteFiles) {
    const kind = resolveFileKind(absoluteFilePath);
    if (!kind) {
      continue;
    }
    const content = await readFile(absoluteFilePath, "utf8");
    sourceFiles.push({
      path: normalizeRepoPath(path.relative(projectRoot, absoluteFilePath)),
      kind,
      content,
    });
  }
  return sourceFiles.sort((left, right) => left.path.localeCompare(right.path));
}

function uniqueAbsolutePaths(values: string[]) {
  return [...new Set(values.map((value) => path.resolve(value)))];
}

export async function runCodeToFigmaPreflightCli(argv: string[]) {
  if (hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
    return {
      exitCode: 0,
      output: usage(),
      report: null,
    };
  }

  const projectRoot = path.resolve(readRequiredFlag(argv, "--project"));
  const projectStat = await stat(projectRoot).catch(() => null);
  if (!projectStat?.isDirectory()) {
    fail(`--project must point to an existing directory: ${projectRoot}`);
  }

  const format = readFlag(argv, "--format") || "text";
  if (format !== "text" && format !== "json") {
    fail(`Unsupported --format: ${format}`);
  }

  const entryPaths = readFlags(argv, "--entry");
  const sourceRoots = readFlags(argv, "--source-root");
  const outputPath = readFlag(argv, "--out");
  const allowBlocked = hasFlag(argv, "--allow-blocked");
  const projectName = await readProjectName(projectRoot);
  const files = await collectSourceFiles(projectRoot, sourceRoots);

  if (files.length === 0) {
    fail(`No supported source files were found under ${projectRoot}`);
  }

  const report = runCodeToFigmaPreflight({
    projectRoot,
    projectName,
    entryPaths,
    files,
  });

  if (outputPath) {
    const resolvedOutputPath = path.resolve(outputPath);
    await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
    await writeFile(resolvedOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  return {
    exitCode: report.supported || allowBlocked ? 0 : 1,
    output: format === "json" ? JSON.stringify(report, null, 2) : formatCodeToFigmaPreflightReport(report),
    report,
  };
}

export async function main(argv = process.argv) {
  try {
    const result = await runCodeToFigmaPreflightCli(argv);
    console.log(result.output);
    if (result.exitCode !== 0) {
      process.exitCode = result.exitCode;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "code-to-figma preflight failed");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
