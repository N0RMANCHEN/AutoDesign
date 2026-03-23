import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportScript = path.join(repoRoot, "scripts", "create-acceptance-report.mjs");
const preflightScript = path.join(repoRoot, "scripts", "create-acceptance-preflight.mjs");

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

function maybePushFlag(args, name, value) {
  if (value) {
    args.push(name, value);
  }
}

function runNodeScript(scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function printNextSteps({ timestamp, scenario }) {
  const baseName = `acceptance-${timestamp}`;
  const artifactRoot = path.join("reports", "acceptance", "artifacts", timestamp);
  console.log("");
  console.log("[acceptance:prep] ready");
  console.log(`[acceptance:prep] report: reports/acceptance/${baseName}.md`);
  console.log(`[acceptance:prep] payload: reports/acceptance/${baseName}.json`);
  console.log(`[acceptance:prep] preflight: ${artifactRoot}/preflight-summary.txt`);
  console.log(`[acceptance:prep] scenario: ${scenario}`);
  console.log("[acceptance:prep] next: open the runbook at reports/acceptance/RUNBOOK.md");
}

function main() {
  const timestamp = readFlag(process.argv, "--timestamp") || nowTimestamp();
  const scenario = readFlag(process.argv, "--scenario") || "live-figma-bridge";
  const owner = readFlag(process.argv, "--owner");
  const status = readFlag(process.argv, "--status");
  const scope = readFlag(process.argv, "--scope");
  const scenarioText = readFlag(process.argv, "--scenario-text");
  const session = readFlag(process.argv, "--session");

  const reportArgs = ["--timestamp", timestamp, "--scenario", scenario];
  maybePushFlag(reportArgs, "--owner", owner);
  maybePushFlag(reportArgs, "--status", status);
  maybePushFlag(reportArgs, "--scope", scope);
  maybePushFlag(reportArgs, "--scenario-text", scenarioText);

  const preflightArgs = ["--timestamp", timestamp, "--scenario", scenario];
  maybePushFlag(preflightArgs, "--session", session);

  // Create the report first so a failed preflight still leaves an explicit acceptance record.
  runNodeScript(reportScript, reportArgs);
  runNodeScript(preflightScript, preflightArgs);
  printNextSteps({ timestamp, scenario });
}

main();
