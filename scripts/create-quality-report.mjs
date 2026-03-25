import { mkdir, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDirectory = process.env.AUTODESIGN_REPORT_ROOT
  ? path.resolve(process.env.AUTODESIGN_REPORT_ROOT)
  : process.cwd();
const qualityDirectory = path.join(rootDirectory, "reports", "quality");

export const QUALITY_SCENARIO_PRESETS = {
  "reconstruction-measure": {
    scope: "Reconstruction quality measurement",
    inputs: [
      "reconstruction job id",
      "target/reference case id",
    ],
    measurements: [
      "Record composite score, gates, hotspot and visible mismatch summary.",
    ],
    findings: [
      "Summarize whether the rendered result is converging and where the main residual mismatch remains.",
    ],
    followUp: [
      "Link the next refine, analysis adjustment or acceptance decision.",
    ],
  },
  "workflow-regression": {
    scope: "Workflow regression review",
    inputs: [
      "changed workflow entrypoints",
      "verification command set",
    ],
    measurements: [
      "Record which success and failure paths were exercised and whether outputs stayed stable.",
    ],
    findings: [
      "Summarize whether the workflow stayed contract-compatible after the change.",
    ],
    followUp: [
      "Record any remaining risk that still requires acceptance or follow-up hardening.",
    ],
  },
  "design-context-review": {
    scope: "Design-context quality review",
    inputs: [
      "target design-context or mapping surface",
      "related metadata / variable / screenshot sources",
    ],
    measurements: [
      "Record completeness, freshness and dependency-truth coverage for the reviewed context surface.",
    ],
    findings: [
      "Summarize whether the context surface is stable enough for downstream implementation work.",
    ],
    followUp: [
      "Record the next gap to close if the context surface is still missing critical fields or evidence.",
    ],
  },
};

function readFlag(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function readFlags(argv, name) {
  const values = [];
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function ensureQualityReportDoesNotExist(filePath) {
  try {
    await stat(filePath);
    throw new Error(`Quality report already exists: ${filePath}`);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

function formatBulletList(items, fallbackLine) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${fallbackLine}`;
}

export function buildQualityMarkdown({
  timestamp,
  scope,
  owner,
  inputs,
  measurements,
  findings,
  artifacts,
  followUp,
}) {
  return `# Quality ${timestamp}

- Timestamp: \`${timestamp}\`
- Scope: ${scope}
- Owner: ${owner}

## Inputs

${formatBulletList(inputs, "Pending scope-specific inputs.")}

## Measurements

${formatBulletList(measurements, "Pending measurement results.")}

## Findings

${formatBulletList(findings, "Pending findings.")}

## Artifacts

${formatBulletList(artifacts, "Pending capture.")}

## Follow-up

${formatBulletList(followUp, "Pending follow-up.")}
`;
}

export function resolveQualityReportPaths(baseDirectory, timestamp) {
  const baseName = `quality-${timestamp}`;
  return {
    baseName,
    markdownPath: path.join(baseDirectory, `${baseName}.md`),
    jsonPath: path.join(baseDirectory, `${baseName}.json`),
  };
}

export async function writeQualityReportFiles(baseDirectory, payload) {
  const { markdownPath, jsonPath } = resolveQualityReportPaths(baseDirectory, payload.timestamp);
  const markdown = buildQualityMarkdown({
    timestamp: payload.timestamp,
    scope: payload.scope,
    owner: payload.owner,
    inputs: payload.inputs,
    measurements: payload.measurements,
    findings: payload.findings,
    artifacts: payload.artifacts,
    followUp: payload.follow_up,
  });

  await writeFile(markdownPath, markdown, "utf8");
  await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { markdownPath, jsonPath };
}

async function main() {
  const scenarioKey = readFlag(process.argv, "--scenario") || "reconstruction-measure";
  const preset = QUALITY_SCENARIO_PRESETS[scenarioKey];
  if (!preset) {
    throw new Error(
      `Unsupported quality scenario: ${scenarioKey}. Supported: ${Object.keys(QUALITY_SCENARIO_PRESETS).join(", ")}`,
    );
  }

  const timestamp = readFlag(process.argv, "--timestamp") || nowTimestamp();
  if (!/^[0-9]{8}-[0-9]{6}$/.test(timestamp)) {
    throw new Error(`Invalid --timestamp: ${timestamp}`);
  }

  const owner = readFlag(process.argv, "--owner") || "TBD";
  const scope = readFlag(process.argv, "--scope") || preset.scope;
  const inputs = readFlags(process.argv, "--input");
  const measurements = readFlags(process.argv, "--measurement");
  const findings = readFlags(process.argv, "--finding");
  const artifacts = readFlags(process.argv, "--artifact");
  const followUp = readFlags(process.argv, "--follow-up");

  const { markdownPath, jsonPath } = resolveQualityReportPaths(qualityDirectory, timestamp);

  await mkdir(qualityDirectory, { recursive: true });
  await ensureQualityReportDoesNotExist(markdownPath);
  await ensureQualityReportDoesNotExist(jsonPath);

  const payload = {
    kind: "quality_report",
    timestamp,
    scope,
    owner,
    inputs: inputs.length ? inputs : preset.inputs,
    measurements: measurements.length ? measurements : preset.measurements,
    findings: findings.length ? findings : preset.findings,
    artifacts,
    follow_up: followUp.length ? followUp : preset.followUp,
  };

  await writeQualityReportFiles(qualityDirectory, payload);

  console.log(`quality report created: ${path.relative(rootDirectory, markdownPath)}`);
  console.log(`quality report created: ${path.relative(rootDirectory, jsonPath)}`);
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(message.replace(new RegExp(escapeRegExp(rootDirectory), "g"), "."));
    process.exitCode = 1;
  });
}
