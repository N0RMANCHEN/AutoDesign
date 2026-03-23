import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const registryPath = path.join(root, "config/governance/runtime_write_registry.json");
const scanRoots = ["server", "shared", "src", "plugins", "scripts"];
const ignoredDirs = new Set(["node_modules", ".git", ".next", "dist", "dist-server"]);
const ignoredFilePattern = /\.(test|spec)\.(ts|tsx|js|mjs)$/;

async function walk(dir, files = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, files);
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx|js|mjs)$/.test(entry.name) && !ignoredFilePattern.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function toRepoPath(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/");
}

function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLE_STAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLE_STAR::/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripStringsAndComments(content) {
  let result = "";
  let i = 0;

  while (i < content.length) {
    const current = content[i];
    const next = content[i + 1];

    if (current === "/" && next === "/") {
      i += 2;
      while (i < content.length && content[i] !== "\n") {
        i += 1;
      }
      continue;
    }

    if (current === "/" && next === "*") {
      i += 2;
      while (i < content.length && !(content[i] === "*" && content[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      continue;
    }

    if (current === "'" || current === '"' || current === "`") {
      const quote = current;
      i += 1;
      while (i < content.length) {
        if (content[i] === "\\") {
          i += 2;
          continue;
        }
        if (content[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      result += " ";
      continue;
    }

    result += current;
    i += 1;
  }

  return result;
}

function collectTargetVars(content, targetPath) {
  const vars = new Set();
  const targetName = path.basename(targetPath);
  const declarationPattern = /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(.+)$/gm;
  let match;
  while ((match = declarationPattern.exec(content)) !== null) {
    const variableName = match[1];
    const initializer = match[2];
    if (initializer.includes(targetName)) {
      vars.add(variableName);
    }
  }
  return vars;
}

function fileTouchesTruthStore(content, truthStorePath) {
  const fileName = path.basename(truthStorePath);
  if (content.includes(fileName) && /\b(?:writeFile|appendFile|rename|copyFile)\s*\(/.test(content)) {
    return true;
  }

  const vars = collectTargetVars(content, truthStorePath);
  for (const variableName of vars) {
    const callPattern = new RegExp(
      `\\b(?:writeFile|appendFile|rename|copyFile)\\s*\\([^\\n]*\\b${escapeRegExp(variableName)}\\b`,
      "m",
    );
    if (callPattern.test(content)) {
      return true;
    }
  }
  return false;
}

async function main() {
  await access(registryPath);
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  const failures = [];

  const figmaAllowlist = (registry.figmaApiAllowedGlobs ?? []).map((pattern) => globToRegExp(String(pattern)));
  const truthStores = Array.isArray(registry.truthStores) ? registry.truthStores : [];

  const files = [];
  for (const scanRoot of scanRoots) {
    const scanPath = path.join(root, scanRoot);
    try {
      await access(scanPath);
      await walk(scanPath, files);
    } catch {
      // ignore missing roots
    }
  }

  for (const filePath of files) {
    const repoPath = toRepoPath(filePath);
    const content = await readFile(filePath, "utf8");
    const executableContent = stripStringsAndComments(content);

    if (/\bfigma\./.test(executableContent)) {
      const allowed = figmaAllowlist.some((pattern) => pattern.test(repoPath));
      if (!allowed) {
        failures.push(`figma API usage outside plugin runtime: ${repoPath}`);
      }
    }

    for (const truthStore of truthStores) {
      const targetPath = String(truthStore.path ?? "");
      const allowedWriters = new Set((truthStore.allowedWriters ?? []).map(String));
      if (!targetPath) {
        continue;
      }
      if (fileTouchesTruthStore(content, targetPath) && !allowedWriters.has(repoPath)) {
        failures.push(`unauthorized truth-store writer for ${targetPath}: ${repoPath}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error("check:runtime-write-surfaces failed");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("check:runtime-write-surfaces passed");
}

await main();
