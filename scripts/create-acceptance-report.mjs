import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDirectory = process.env.AUTODESIGN_REPORT_ROOT
  ? path.resolve(process.env.AUTODESIGN_REPORT_ROOT)
  : process.cwd();
const acceptanceDirectory = path.join(rootDirectory, "reports", "acceptance");

const scenarioPresets = {
  "live-figma-bridge": {
    scope: "Live Figma / bridge acceptance",
    scenario: "Validate plugin session registration, bridge online state, command dispatch and visible Figma writeback.",
    commands: [
      "npm run plugin:status",
      "npm run plugin:inspect -- --frame-node-id <FRAME_NODE_ID>",
      "npm run plugin:send -- --json '<COMMAND_BATCH>' --node-ids <NODE_IDS>",
    ],
    steps: [
      "Open Figma Desktop and launch the AutoDesign plugin in the target file.",
      "Confirm npm run plugin:status reports an online session with the expected file and page.",
      "Run one read-only inspect command and one targeted mutating command, then verify the visible result in Figma.",
    ],
    observations: [
      "Record whether the plugin session stayed online during the full command round-trip.",
      "Record whether the visible Figma result matched the targeted command payload.",
    ],
    follow_up: [
      "Attach screenshots or exported previews if the live result differs from the intended target.",
    ],
  },
  "reconstruction-live": {
    scope: "Reconstruction live acceptance",
    scenario: "Validate reconstruction create -> context-pack -> review -> apply -> render -> measure workflow on a live Figma case.",
    commands: [
      "npm run plugin:reconstruct -- --session <SESSION_ID> --target <TARGET_NODE_ID> --reference <REFERENCE_NODE_ID> --strategy hybrid-reconstruction",
      "npm run plugin:reconstruct -- --job <JOB_ID> --context-pack",
      "npm run plugin:reconstruct -- --job <JOB_ID> --apply",
      "npm run plugin:reconstruct -- --job <JOB_ID> --render",
      "npm run plugin:reconstruct -- --job <JOB_ID> --measure",
    ],
    steps: [
      "Create a reconstruction job against a real target frame and reference image.",
      "Review the generated context pack and analysis draft, then apply the approved plan.",
      "Render and measure the result, then compare the visible output and diff metrics.",
    ],
    observations: [
      "Record whether the target frame stayed stable and whether the diff metrics were produced without manual repair.",
      "Record any visible mismatch between the measured result and the reference image.",
    ],
    follow_up: [
      "Link the final job output, rendered preview and any follow-up refine recommendation.",
    ],
  },
  "plugin-smoke": {
    scope: "Plugin smoke acceptance",
    scenario: "Validate that the plugin opens, reports selection and handles one safe command on a live file.",
    commands: [
      "npm run plugin:status",
      "npm run plugin:preview",
    ],
    steps: [
      "Open the plugin in a live file and confirm the session appears online.",
      "Export one preview or inspect one frame to confirm basic bridge connectivity.",
    ],
    observations: [
      "Record whether the plugin session metadata and selection summary looked correct.",
    ],
    follow_up: [
      "Escalate to live bridge acceptance if smoke validation exposes session drift or missing previews.",
    ],
  },
};

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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function ensureDoesNotExist(filePath) {
  try {
    await stat(filePath);
    throw new Error(`Acceptance report already exists: ${filePath}`);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

function buildMarkdown({
  timestamp,
  status,
  scope,
  owner,
  scenario,
  commands,
  steps,
  observations,
  artifacts,
  followUp,
}) {
  return `# Acceptance ${timestamp}

- Timestamp: \`${timestamp}\`
- Status: \`${status}\`
- Scope: ${scope}
- Owner: ${owner}

## Scenario

- ${scenario}

## Commands

${commands.map((command) => `- \`${command}\``).join("\n")}

## Steps

${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}

## Result

- \`${status}\`
- ${observations.join("\n- ")}

## Artifacts

${artifacts.map((artifact) => `- ${artifact}`).join("\n")}

## Follow-up

${followUp.map((item) => `- ${item}`).join("\n")}
`;
}

async function main() {
  const scenarioKey = readFlag(process.argv, "--scenario") || "live-figma-bridge";
  const preset = scenarioPresets[scenarioKey];
  if (!preset) {
    throw new Error(
      `Unsupported acceptance scenario: ${scenarioKey}. Supported: ${Object.keys(scenarioPresets).join(", ")}`,
    );
  }

  const timestamp = readFlag(process.argv, "--timestamp") || nowTimestamp();
  if (!/^[0-9]{8}-[0-9]{6}$/.test(timestamp)) {
    throw new Error(`Invalid --timestamp: ${timestamp}`);
  }

  const status = readFlag(process.argv, "--status") || "PASS";
  if (status !== "PASS" && status !== "FAIL") {
    throw new Error(`Invalid --status: ${status}`);
  }

  const owner = readFlag(process.argv, "--owner") || "TBD";
  const scope = readFlag(process.argv, "--scope") || preset.scope;
  const scenario = readFlag(process.argv, "--scenario-text") || preset.scenario;
  const baseName = `acceptance-${timestamp}`;
  const markdownPath = path.join(acceptanceDirectory, `${baseName}.md`);
  const jsonPath = path.join(acceptanceDirectory, `${baseName}.json`);

  await mkdir(acceptanceDirectory, { recursive: true });
  await ensureDoesNotExist(markdownPath);
  await ensureDoesNotExist(jsonPath);

  const artifacts = [
    path.relative(rootDirectory, markdownPath),
    path.relative(rootDirectory, jsonPath),
    "Add screenshots / exported previews / rendered diffs here",
  ];
  const payload = {
    kind: "acceptance_report",
    timestamp,
    status,
    scope,
    owner,
    scenario,
    commands: preset.commands,
    steps: preset.steps,
    observations: preset.observations,
    artifacts,
    follow_up: preset.follow_up,
  };

  const markdown = buildMarkdown({
    timestamp,
    status,
    scope,
    owner,
    scenario,
    commands: payload.commands,
    steps: payload.steps,
    observations: payload.observations,
    artifacts: payload.artifacts,
    followUp: payload.follow_up,
  });

  await writeFile(markdownPath, markdown, "utf8");
  await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`acceptance report created: ${path.relative(rootDirectory, markdownPath)}`);
  console.log(`acceptance report created: ${path.relative(rootDirectory, jsonPath)}`);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(message.replace(new RegExp(escapeRegExp(rootDirectory), "g"), "."));
  process.exitCode = 1;
});
