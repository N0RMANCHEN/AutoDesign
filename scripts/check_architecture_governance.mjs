import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const rulesPath = path.join(root, "config/governance/architecture_rules.json");
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

async function main() {
  const rules = JSON.parse(await readFile(rulesPath, "utf8"));
  const failures = [];
  const warnings = [];

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
  const graceMap = rules.lineLimitGrace ?? {};

  for (const filePath of files) {
    const repoPath = toRepoPath(filePath);
    if (!["shared/", "server/", "src/", "plugins/"].some((prefix) => repoPath.startsWith(prefix))) {
      continue;
    }
    if (repoPath.includes("/dist/")) {
      continue;
    }

    const content = await readFile(filePath, "utf8");
    const lines = content.split("\n").length;
    const grace = graceMap[repoPath];
    if (grace) {
      const maxAllowed = Number(grace.maxAllowed ?? lineHard);
      if (lines > maxAllowed) {
        failures.push(`line-limit grace exceeded: ${repoPath} (${lines} > ${maxAllowed})`);
      } else if (lines > lineDefault) {
        warnings.push(`line-limit grace advisory: ${repoPath} (${lines} > ${lineDefault})`);
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
