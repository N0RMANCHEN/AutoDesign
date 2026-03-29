import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDirectory = process.env.AUTODESIGN_REPORT_ROOT
  ? path.resolve(process.env.AUTODESIGN_REPORT_ROOT)
  : process.cwd();
const runtimeReadCliScript = path.join(repoRoot, "scripts", "runtime-read-cli.ts");
const baseUrl =
  process.env.AUTODESIGN_API_URL ??
  process.env.FIGMATEST_API_URL ??
  "http://localhost:3001";
const apiFixtureDirectory = process.env.AUTODESIGN_API_FIXTURE_DIR
  ? path.resolve(process.env.AUTODESIGN_API_FIXTURE_DIR)
  : null;

function fail(message) {
  throw new Error(message);
}

function readFlag(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function nowTimestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join("") +
    "-" +
    [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join("");
}

function toFixtureName(pathname, method) {
  const normalizedPath = pathname.replace(/^\//, "").replace(/[/?=&:]+/g, "__");
  return `${method.toLowerCase()}__${normalizedPath || "root"}.json`;
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function requestJson(pathname, init) {
  if (apiFixtureDirectory) {
    const method = String(init?.method || "GET").toUpperCase();
    return readJsonFile(path.join(apiFixtureDirectory, toFixtureName(pathname, method)));
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      if (payload?.error) {
        detail = `${detail} - ${payload.error}`;
      }
    } catch {
      // Ignore non-JSON error bodies.
    }
    fail(`Request failed: ${detail}`);
  }

  return response.json();
}

function sanitizeFileSegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "artifact";
}

function pickSession(sessions, explicitSessionId) {
  if (!Array.isArray(sessions) || !sessions.length) {
    fail("当前没有在线插件会话。请先在 Figma 里打开 AutoDesign。");
  }

  if (explicitSessionId) {
    const found = sessions.find((session) => session.id === explicitSessionId);
    if (!found) {
      fail(`没有找到 session: ${explicitSessionId}`);
    }
    return found;
  }

  return [...sessions].sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))[0];
}

function decodePngDataUrl(dataUrl, label) {
  const match = /^data:image\/png;base64,(.+)$/.exec(String(dataUrl || ""));
  if (!match) {
    fail(`${label} 的预览数据格式无效。`);
  }
  return Buffer.from(match[1], "base64");
}

function buildSummary({
  timestamp,
  scenario,
  snapshotPath,
  session,
  exportedPreviews,
  runtimeArtifacts,
}) {
  const lines = [
    `timestamp: ${timestamp}`,
    `scenario: ${scenario}`,
    `session: ${session.id}`,
    `target: ${session.fileName} / ${session.pageName}`,
    `status: ${session.status}`,
    `selectionCount: ${Array.isArray(session.selection) ? session.selection.length : 0}`,
    `supportsExplicitNodeTargeting: ${session.runtimeFeatures?.supportsExplicitNodeTargeting ? "yes" : "no"}`,
    `snapshot: ${snapshotPath}`,
    "capabilities:",
  ];

  for (const capability of session.capabilities || []) {
    lines.push(`- ${capability.id}`);
  }

  lines.push("selection:");
  for (const [index, node] of (session.selection || []).entries()) {
    lines.push(`- [${index}] ${node.name} [${node.type}] id=${node.id}`);
  }

  lines.push("previewArtifacts:");
  if (!exportedPreviews.length) {
    lines.push("- none");
  } else {
    for (const artifact of exportedPreviews) {
      lines.push(`- ${artifact}`);
    }
  }

  if (runtimeArtifacts.length > 0) {
    lines.push("runtimeReadArtifacts:");
    for (const artifact of runtimeArtifacts) {
      lines.push(`- ${artifact}`);
    }
  }

  lines.push("nextSuggestedSteps:");
  lines.push("- Confirm the plugin session remains online in Figma.");
  if (scenario === "runtime-read-live") {
    lines.push("- Open the runtime-read artifacts and confirm session, node and dependency truth are aligned before trusting downstream context consumers.");
    lines.push("- If the selection or runtime artifact target is wrong, fix the live session first and rerun acceptance:prep.");
  } else {
    lines.push("- If the selection is correct, proceed with the live acceptance steps in the generated report.");
  }
  return `${lines.join("\n")}\n`;
}

function runRuntimeReadCli(args) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", runtimeReadCliScript, ...args],
    {
      cwd: repoRoot,
      env: process.env,
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    fail(result.stderr?.trim() || result.stdout?.trim() || "runtime:read failed");
  }

  return JSON.parse(result.stdout);
}

async function writeJsonArtifact(artifactDirectory, fileName, payload) {
  const filePath = path.join(artifactDirectory, fileName);
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return path.relative(rootDirectory, filePath);
}

async function collectRuntimeReadArtifacts({
  artifactDirectory,
  session,
}) {
  const artifacts = [];
  const bridgeOverview = runRuntimeReadCli(["bridge_overview"]);
  artifacts.push(await writeJsonArtifact(artifactDirectory, "runtime-bridge-overview.json", bridgeOverview));

  const designContext = runRuntimeReadCli([
    "get_design_context",
    "--session",
    session.id,
  ]);
  artifacts.push(await writeJsonArtifact(artifactDirectory, "runtime-design-context.json", designContext));

  const variableDefs = runRuntimeReadCli([
    "get_variable_defs",
    "--session",
    session.id,
  ]);
  artifacts.push(await writeJsonArtifact(artifactDirectory, "runtime-variable-defs.json", variableDefs));

  const primaryNode = Array.isArray(session.selection) ? session.selection[0] ?? null : null;
  if (!primaryNode) {
    return artifacts;
  }

  const nodeLabel = sanitizeFileSegment(primaryNode.name || primaryNode.id);
  const nodeMetadata = runRuntimeReadCli([
    "get_node_metadata",
    "--session",
    session.id,
    "--node-id",
    primaryNode.id,
  ]);
  artifacts.push(
    await writeJsonArtifact(
      artifactDirectory,
      `runtime-node-metadata-${nodeLabel}.json`,
      nodeMetadata,
    ),
  );

  const screenshotOutputPath = path.join(
    artifactDirectory,
    `runtime-screenshot-${nodeLabel}.png`,
  );
  const screenshot = runRuntimeReadCli([
    "get_screenshot",
    "--session",
    session.id,
    "--node-id",
    primaryNode.id,
    "--allow-live-export",
    "--out",
    screenshotOutputPath,
  ]);
  artifacts.push(
    await writeJsonArtifact(
      artifactDirectory,
      `runtime-screenshot-${nodeLabel}.json`,
      screenshot,
    ),
  );
  if (screenshot.artifactPath) {
    artifacts.push(path.relative(rootDirectory, screenshot.artifactPath));
  }

  return artifacts;
}

async function main() {
  const timestamp = readFlag(process.argv, "--timestamp") || nowTimestamp();
  const scenario = readFlag(process.argv, "--scenario") || "live-figma-bridge";
  const explicitSessionId = readFlag(process.argv, "--session");
  const artifactDirectory = path.join(
    rootDirectory,
    "reports",
    "acceptance",
    "artifacts",
    timestamp,
  );

  await mkdir(artifactDirectory, { recursive: true });

  const snapshot = await requestJson("/api/plugin-bridge");
  const session = pickSession(snapshot.sessions, explicitSessionId);
  const snapshotPath = path.join(artifactDirectory, "plugin-bridge-snapshot.json");
  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  const exportedPreviews = [];
  for (const [index, node] of (session.selection || []).entries()) {
    if (!node.previewDataUrl) {
      continue;
    }
    const fileName = `${index}-${sanitizeFileSegment(node.name)}.png`;
    const filePath = path.join(artifactDirectory, fileName);
    await writeFile(filePath, decodePngDataUrl(node.previewDataUrl, node.name));
    exportedPreviews.push(path.relative(rootDirectory, filePath));
  }

  const runtimeArtifacts = scenario === "runtime-read-live"
    ? await collectRuntimeReadArtifacts({
        artifactDirectory,
        session,
      })
    : [];

  const summaryPath = path.join(artifactDirectory, "preflight-summary.txt");
  const summary = buildSummary({
    timestamp,
    scenario,
    snapshotPath: path.relative(rootDirectory, snapshotPath),
    session,
    exportedPreviews,
    runtimeArtifacts,
  });
  await writeFile(summaryPath, summary, "utf8");

  console.log(`acceptance preflight created: ${path.relative(rootDirectory, snapshotPath)}`);
  console.log(`acceptance preflight created: ${path.relative(rootDirectory, summaryPath)}`);
  for (const artifact of exportedPreviews) {
    console.log(`acceptance preflight created: ${artifact}`);
  }
  for (const artifact of runtimeArtifacts) {
    console.log(`acceptance preflight created: ${artifact}`);
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(message);
  process.exitCode = 1;
});
