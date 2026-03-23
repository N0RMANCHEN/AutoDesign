import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const errors = [];

const ignoredDirs = new Set([
  ".git",
  ".next",
  ".codex",
  ".claude",
  "node_modules",
  "dist",
  "dist-server",
]);

const keyDocs = [
  "README.md",
  "AGENT.md",
  "contributing_ai.md",
  "doc/Project-Map.md",
  "doc/Architecture-Folder-Governance.md",
  "doc/Product-Standards.md",
  "doc/Test-Standards.md",
  "doc/Roadmap.md",
  "doc/plans/archive/README.md",
  "doc/ai/README.md",
  "doc/ai/runtime/README.md",
  "reports/README.md",
];

const forbiddenStatusPatterns = [
  /更新日期/u,
  /current_focus/u,
  /plugin_runtime/u,
  /workspace_runtime/u,
  /bridge_runtime/u,
  /documentation_governance/u,
  /active_owner_cap/u,
  /状态：`?(?:in_progress|todo|done|active|completed)`?/u,
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) {
        continue;
      }
      files.push(...(await walk(path.join(dir, entry.name))));
      continue;
    }
    files.push(path.join(dir, entry.name));
  }
  return files;
}

function toRepoPath(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/");
}

function addError(filePath, message) {
  errors.push(`${toRepoPath(filePath)}: ${message}`);
}

function parseMarkdownLinks(content) {
  const links = [];
  const linkPattern = /\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = linkPattern.exec(content)) !== null) {
    links.push(match[1]);
  }
  return links;
}

async function assertExists(repoPath) {
  try {
    await access(path.join(root, repoPath));
  } catch {
    errors.push(`${repoPath}: missing required document`);
  }
}

function checkForbiddenStatus(filePath, content) {
  for (const pattern of forbiddenStatusPatterns) {
    if (pattern.test(content)) {
      addError(filePath, `contains roadmap-style status field matching ${pattern}`);
    }
  }
}

async function main() {
  for (const repoPath of keyDocs) {
    await assertExists(repoPath);
  }

  const allFiles = await walk(root);
  const markdownFiles = allFiles.filter((filePath) => filePath.endsWith(".md"));

  for (const filePath of markdownFiles) {
    const content = await readFile(filePath, "utf8");

    if (content.includes("/Users/")) {
      addError(filePath, "contains machine-specific absolute path");
    }

    for (const target of parseMarkdownLinks(content)) {
      if (
        target.startsWith("http://") ||
        target.startsWith("https://") ||
        target.startsWith("mailto:") ||
        target.startsWith("#")
      ) {
        continue;
      }

      if (target.startsWith("/")) {
        addError(filePath, `contains absolute internal link: ${target}`);
        continue;
      }

      const [pathname] = target.split("#");
      const normalized = pathname.split("?")[0];
      if (!normalized) {
        continue;
      }

      const resolved = path.resolve(path.dirname(filePath), normalized);
      try {
        await access(resolved);
      } catch {
        addError(filePath, `broken markdown link: ${target}`);
      }
    }

    const repoPath = toRepoPath(filePath);
    const inPlans =
      repoPath.startsWith("doc/plans/") &&
      !repoPath.startsWith("doc/plans/archive/") &&
      !repoPath.endsWith("README.md") &&
      !repoPath.endsWith("_template.md");
    const inReports =
      repoPath.startsWith("reports/") &&
      !repoPath.endsWith("README.md") &&
      !repoPath.endsWith("TEMPLATE.md");

    if (inPlans || inReports) {
      checkForbiddenStatus(filePath, content);
    }
  }

  const actionsRoot = path.join(root, "doc/ai/runtime/actions");
  const domains = await readdir(actionsRoot, { withFileTypes: true });
  for (const domainEntry of domains) {
    if (!domainEntry.isDirectory()) {
      continue;
    }

    const domain = domainEntry.name;
    const schemaPath = path.join(root, "doc/ai/runtime/contracts", `graphpatch.${domain}.schema.json`);
    try {
      await access(schemaPath);
    } catch {
      errors.push(`doc/ai/runtime/contracts/graphpatch.${domain}.schema.json: missing schema for action domain ${domain}`);
    }

    const actionDir = path.join(actionsRoot, domain);
    const actionEntries = await readdir(actionDir, { withFileTypes: true });
    for (const actionEntry of actionEntries) {
      if (!actionEntry.isFile() || !actionEntry.name.endsWith(".md")) {
        continue;
      }
      const actionPath = path.join(actionDir, actionEntry.name);
      const content = await readFile(actionPath, "utf8");
      if (!content.includes("Schema:")) {
        addError(actionPath, "missing Schema declaration");
      }
      if (!content.includes("当前接入状态：")) {
        addError(actionPath, "missing 当前接入状态 declaration");
      }
    }
  }

  if (errors.length > 0) {
    console.error("verify:docs failed");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`verify:docs passed (${markdownFiles.length} markdown files checked)`);
}

await main();
