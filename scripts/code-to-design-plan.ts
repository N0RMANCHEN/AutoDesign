import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildCodeToDesignPlan,
  type CodeToDesignImageStrategy,
  formatCodeToDesignPlan,
} from "../shared/code-to-design-plan.js";
import type { CodeToDesignRuntimeSnapshot } from "../shared/code-to-design-snapshot.js";

function fail(message: string): never {
  throw new Error(message);
}

function readFlag(argv: string[], name: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function hasFlag(argv: string[], name: string) {
  return argv.includes(name);
}

function usage() {
  return [
    "Usage:",
    "  npm run code-to-design:plan -- --snapshot data/aitest-snapshot.json --parent-node-id 1:2",
    "  npm run code-to-design:plan -- --snapshot data/aitest-snapshot.json --parent-node-id 1:2 --out data/aitest-batch.json --format json",
    "  npm run code-to-design:plan -- --snapshot data/aitest-snapshot.json --parent-node-id 1:2 --quality-out data/aitest-quality.json --layout-out data/aitest-layout.json",
  ].join("\n");
}

export async function runCodeToDesignPlanCli(argv: string[]) {
  if (hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
    return {
      exitCode: 0,
      output: usage(),
      plan: null,
    };
  }

  const snapshotPath = readFlag(argv, "--snapshot");
  if (!snapshotPath || snapshotPath.startsWith("--")) {
    fail(`--snapshot is required\n\n${usage()}`);
  }
  const parentNodeId = readFlag(argv, "--parent-node-id");
  if (!parentNodeId || parentNodeId.startsWith("--")) {
    fail(`--parent-node-id is required\n\n${usage()}`);
  }

  const frameName = readFlag(argv, "--frame-name") || undefined;
  const imageStrategyRaw = readFlag(argv, "--image-strategy") || "node";
  const imageStrategy: CodeToDesignImageStrategy =
    imageStrategyRaw === "node" || imageStrategyRaw === "frame_raster"
      ? imageStrategyRaw
      : fail(`Unsupported --image-strategy: ${imageStrategyRaw}`);
  const format = readFlag(argv, "--format") || "text";
  if (format !== "text" && format !== "json") {
    fail(`Unsupported --format: ${format}`);
  }

  const raw = await readFile(path.resolve(snapshotPath), "utf8");
  const snapshot = JSON.parse(raw) as CodeToDesignRuntimeSnapshot;
  const plan = buildCodeToDesignPlan({
    snapshot,
    frameName,
    parentNodeId,
    imageStrategy,
  });

  const outputPath = readFlag(argv, "--out");
  if (outputPath) {
    const resolvedOutputPath = path.resolve(outputPath);
    await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
    await writeFile(resolvedOutputPath, `${JSON.stringify(plan.batch, null, 2)}\n`, "utf8");
  }

  const qualityOutputPath = readFlag(argv, "--quality-out");
  if (qualityOutputPath) {
    const resolvedQualityOutputPath = path.resolve(qualityOutputPath);
    await mkdir(path.dirname(resolvedQualityOutputPath), { recursive: true });
    await writeFile(resolvedQualityOutputPath, `${JSON.stringify(plan.qualityReport, null, 2)}\n`, "utf8");
  }

  const layoutOutputPath = readFlag(argv, "--layout-out");
  if (layoutOutputPath) {
    const resolvedLayoutOutputPath = path.resolve(layoutOutputPath);
    await mkdir(path.dirname(resolvedLayoutOutputPath), { recursive: true });
    await writeFile(resolvedLayoutOutputPath, `${JSON.stringify(plan.layoutTree, null, 2)}\n`, "utf8");
  }

  return {
    exitCode: 0,
    output: format === "json" ? JSON.stringify(plan.batch, null, 2) : formatCodeToDesignPlan(plan),
    plan,
  };
}

export async function main(argv = process.argv) {
  try {
    const result = await runCodeToDesignPlanCli(argv);
    console.log(result.output);
    if (result.exitCode !== 0) {
      process.exitCode = result.exitCode;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "code-to-design plan failed");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
