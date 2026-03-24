import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const rulesPath = path.join(root, "config/governance/architecture_rules.json");
const todayIsoDate = new Date().toISOString().slice(0, 10);
const ignoredDirs = new Set(["node_modules", ".git", ".next", "dist", "dist-server"]);
const ignoredFilePattern = /\.(test|spec)\.(ts|tsx|js|mjs)$/;

async function exists(repoPath) {
  try {
    await access(path.join(root, repoPath));
    return true;
  } catch {
    return false;
  }
}

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

function getScope(repoPath) {
  if (repoPath.startsWith("shared/")) return "shared";
  if (repoPath.startsWith("server/")) return "server";
  if (repoPath.startsWith("src/")) return "src";
  if (repoPath.startsWith("plugins/")) return "plugins";
  if (repoPath.startsWith("scripts/")) return "scripts";
  return null;
}

function parseImports(content) {
  const imports = [];
  const pattern =
    /(?:import|export)\s+[^"']*from\s+["']([^"']+)["']|import\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    imports.push(match[1] ?? match[2] ?? match[3]);
  }
  return imports.filter(Boolean);
}

async function readJson(repoPath) {
  return JSON.parse(await readFile(path.join(root, repoPath), "utf8"));
}

function normalizeLineLimitExceptions(registry, failures) {
  const exceptions = new Map();
  for (const [index, item] of (registry?.lineLimitExceptions ?? []).entries()) {
    const repoPath = typeof item?.path === "string" ? item.path.trim() : "";
    const owner = typeof item?.owner === "string" ? item.owner.trim() : "";
    const reason = typeof item?.reason === "string" ? item.reason.trim() : "";
    const expiresAt = typeof item?.expiresAt === "string" ? item.expiresAt.trim() : "";
    const maxAllowed = Number(item?.maxAllowed);
    const label = repoPath || `lineLimitExceptions[${index}]`;

    if (!repoPath) {
      failures.push(`invalid architecture exception path: ${label}`);
      continue;
    }
    if (!owner) {
      failures.push(`missing architecture exception owner: ${label}`);
      continue;
    }
    if (!reason) {
      failures.push(`missing architecture exception reason: ${label}`);
      continue;
    }
    if (!expiresAt || !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
      failures.push(`invalid architecture exception expiry: ${label}`);
      continue;
    }
    if (!Number.isFinite(maxAllowed) || maxAllowed <= 0) {
      failures.push(`invalid architecture exception maxAllowed: ${label}`);
      continue;
    }
    if (expiresAt < todayIsoDate) {
      failures.push(`expired architecture exception: ${repoPath} (expired ${expiresAt})`);
      continue;
    }
    exceptions.set(repoPath, {
      path: repoPath,
      maxAllowed,
      owner,
      reason,
      expiresAt,
    });
  }
  return exceptions;
}

async function main() {
  const rules = JSON.parse(await readFile(rulesPath, "utf8"));
  const failures = [];
  const warnings = [];
  const governedPrefixes = ["shared/", "server/", "src/", "plugins/", "scripts/"];
  const exceptionRegistryPath =
    typeof rules.exceptionRegistry === "string" && rules.exceptionRegistry.trim()
      ? rules.exceptionRegistry.trim()
      : null;
  const exceptionRegistry = exceptionRegistryPath ? await readJson(exceptionRegistryPath) : {};
  const lineLimitExceptions = normalizeLineLimitExceptions(exceptionRegistry, failures);
  const usedExceptions = new Set();

  for (const repoPath of rules.requiredDocs ?? []) {
    if (!(await exists(repoPath))) {
      failures.push(`missing required doc/config: ${repoPath}`);
    }
  }

  for (const repoPath of rules.requiredDirs ?? []) {
    if (!(await exists(repoPath))) {
      failures.push(`missing required directory: ${repoPath}`);
    }
  }

  const files = await walk(root);
  const lineDefault = Number(rules.maxFileLines?.default ?? 800);
  const lineHard = Number(rules.maxFileLines?.hard ?? 2000);

  for (const filePath of files) {
    const repoPath = toRepoPath(filePath);
    if (!governedPrefixes.some((prefix) => repoPath.startsWith(prefix))) {
      continue;
    }
    if (repoPath.includes("/dist/")) {
      continue;
    }

    const content = await readFile(filePath, "utf8");
    const lines = content.split("\n").length;
    const exception = lineLimitExceptions.get(repoPath);
    if (exception) {
      usedExceptions.add(repoPath);
      if (lines > exception.maxAllowed) {
        failures.push(`line-limit exception exceeded: ${repoPath} (${lines} > ${exception.maxAllowed})`);
      } else if (lines > lineDefault) {
        warnings.push(
          `line-limit exception advisory: ${repoPath} (${lines} > ${lineDefault}; owner=${exception.owner}; expires=${exception.expiresAt})`,
        );
      }
    } else if (lines > lineHard) {
      failures.push(`hard line-limit exceeded: ${repoPath} (${lines} > ${lineHard})`);
    } else if (lines > lineDefault) {
      warnings.push(`line-limit advisory: ${repoPath} (${lines} > ${lineDefault})`);
    }

    const scope = getScope(repoPath);
    const dependencyRule = (rules.dependencyRules ?? []).find((item) => item.scope === scope);
    if (!dependencyRule) {
      continue;
    }
    const imports = parseImports(content);
    for (const specifier of imports) {
      if (!specifier.startsWith(".")) {
        continue;
      }
      for (const forbiddenPrefix of dependencyRule.forbid ?? []) {
        if (specifier.startsWith(forbiddenPrefix)) {
          failures.push(`forbidden dependency edge in ${repoPath}: ${specifier}`);
        }
      }
    }
  }

  for (const [repoPath] of lineLimitExceptions) {
    if (usedExceptions.has(repoPath)) {
      continue;
    }
    if (!(await exists(repoPath))) {
      failures.push(`orphaned architecture exception: ${repoPath}`);
    }
  }

  if (failures.length > 0) {
    console.error("governance:check failed");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    for (const warning of warnings) {
      console.error(`- warning: ${warning}`);
    }
    process.exit(1);
  }

  console.log("governance:check passed");
  if (warnings.length > 0) {
    for (const warning of warnings) {
      console.log(`warning: ${warning}`);
    }
  }
}

await main();
