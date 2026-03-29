import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildCodeToDesignFontInstallAssessment,
  syncCodeToDesignFontBundle,
} from "../shared/code-to-design-fonts.js";
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
    "  npm run code-to-design:fonts -- --snapshot /tmp/aitest-snapshot.json",
    "  npm run code-to-design:fonts -- --snapshot /tmp/aitest-snapshot.json --sync-bundle --project ../AItest --dist ../AItest/dist",
    "  npm run code-to-design:fonts -- --snapshot /tmp/aitest-snapshot.json --install --target-dir ~/Library/Fonts",
    "  npm run code-to-design:fonts -- --snapshot /tmp/aitest-snapshot.json --project ../AItest --dist ../AItest/dist",
  ].join("\n");
}

export async function runCodeToDesignFontsCli(argv: string[]) {
  if (hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
    return {
      exitCode: 0,
      output: usage(),
    };
  }

  const snapshotPath = readFlag(argv, "--snapshot");
  if (!snapshotPath) {
    fail(`--snapshot is required\n\n${usage()}`);
  }
  const raw = await readFile(path.resolve(snapshotPath), "utf8");
  const snapshot = JSON.parse(raw) as CodeToDesignRuntimeSnapshot;
  const syncBundle = hasFlag(argv, "--sync-bundle");
  const syncReport = syncBundle
    ? await syncCodeToDesignFontBundle({
        snapshot,
        bundleRoot: readFlag(argv, "--font-bundle-root"),
        projectRoot: readFlag(argv, "--project"),
        distRoot: readFlag(argv, "--dist"),
      })
    : null;
  const syncOutPath = readFlag(argv, "--sync-out");
  if (syncReport && syncOutPath) {
    await writeFile(path.resolve(syncOutPath), `${JSON.stringify(syncReport, null, 2)}\n`, "utf8");
  }
  const report = await buildCodeToDesignFontInstallAssessment({
    snapshot,
    bundleRoot: readFlag(argv, "--font-bundle-root"),
    projectRoot: readFlag(argv, "--project"),
    distRoot: readFlag(argv, "--dist"),
    install: hasFlag(argv, "--install"),
    targetDir: readFlag(argv, "--target-dir"),
  });

  const outPath = readFlag(argv, "--out");
  if (outPath) {
    await writeFile(path.resolve(outPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  return {
    exitCode: report.status === "pass" ? 0 : 1,
    output: [
      "Code-to-Design Fonts",
      `status: ${report.status}`,
      `bundleRoot: ${report.bundleRoot}`,
      `manifestPath: ${report.manifestPath}`,
      `requiredFonts: ${report.requiredFonts.length}`,
      ...(syncReport
        ? [
            `bundleSync: ${syncReport.status}`,
            `bundleSyncedEntries: ${syncReport.syncedEntries.length}`,
            `bundleUnresolvedEntries: ${syncReport.unresolvedEntries.length}`,
          ]
        : []),
      `missingManifestEntries: ${report.missingManifestEntries.length}`,
      `missingFiles: ${report.missingFiles.length}`,
      `installedFiles: ${report.installedFiles.length}`,
      ...(outPath ? [`report: ${path.resolve(outPath)}`] : []),
      ...(syncReport && syncOutPath ? [`bundleSyncReport: ${path.resolve(syncOutPath)}`] : []),
      ...(syncReport?.notes || []).map((note) => `note: ${note}`),
      ...report.notes.map((note) => `note: ${note}`),
    ].join("\n"),
  };
}

export async function main(argv = process.argv) {
  try {
    const result = await runCodeToDesignFontsCli(argv);
    console.log(result.output);
    if (result.exitCode !== 0) {
      process.exitCode = result.exitCode;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "code-to-design fonts failed");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
