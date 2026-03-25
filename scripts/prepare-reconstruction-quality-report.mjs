import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  ensureQualityReportDoesNotExist,
  resolveQualityReportPaths,
  writeQualityReportFiles,
} from "./create-quality-report.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportRoot = process.env.AUTODESIGN_REPORT_ROOT
  ? path.resolve(process.env.AUTODESIGN_REPORT_ROOT)
  : repoRoot;
const qualityDirectory = path.join(reportRoot, "reports", "quality");
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

function decodeImageDataUrl(dataUrl, label) {
  const match = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!match) {
    fail(`${label} previewDataUrl is invalid.`);
  }
  const mimeSubtype = String(match[1]).toLowerCase();
  const extension = mimeSubtype === "jpeg" ? "jpg" : mimeSubtype;
  return {
    buffer: Buffer.from(match[2], "base64"),
    extension,
  };
}

function formatNumber(value) {
  return Number(value).toFixed(4);
}

function formatGateSummary(gate) {
  return `${gate.label} (${gate.metric} ${gate.comparator} ${gate.threshold.toFixed(3)}, actual=${gate.actual.toFixed(3)})`;
}

function formatBounds(bounds) {
  return `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
}

function buildMeasurements(job) {
  const diffMetrics = job.diffMetrics;
  const failedGates = diffMetrics.acceptanceGates.filter((gate) => !gate.passed);
  const hardFailedGateCount = failedGates.filter((gate) => gate.hard).length;
  const passedGateCount = diffMetrics.acceptanceGates.length - failedGates.length;
  const measurements = [
    `job=${job.id} strategy=${job.input.strategy} stage=${job.currentStageId} status=${job.status} applyStatus=${job.applyStatus} loopStatus=${job.loopStatus}`,
    `composite=${formatNumber(diffMetrics.compositeScore)} grade=${diffMetrics.grade} global=${formatNumber(diffMetrics.globalSimilarity)} layout=${formatNumber(diffMetrics.layoutSimilarity)} structure=${formatNumber(diffMetrics.structureSimilarity)} edge=${formatNumber(diffMetrics.edgeSimilarity)} colorDelta=${formatNumber(diffMetrics.colorDelta)}`,
    `acceptance_gates=${passedGateCount}/${diffMetrics.acceptanceGates.length} passed; failed=${failedGates.length}; hard_failed=${hardFailedGateCount}; hotspot_avg=${formatNumber(diffMetrics.hotspotAverage)}; hotspot_peak=${formatNumber(diffMetrics.hotspotPeak)}; hotspot_coverage=${formatNumber(diffMetrics.hotspotCoverage)}`,
  ];

  if (diffMetrics.hotspots.length) {
    const hotspot = diffMetrics.hotspots[0];
    measurements.push(
      `top_hotspot=${hotspot.id} score=${formatNumber(hotspot.score)} bounds=${formatBounds(hotspot.bounds)}`,
    );
  }

  if (job.structureReport) {
    const framePreserved =
      job.structureReport.targetFramePreserved === null
        ? "unknown"
        : job.structureReport.targetFramePreserved
          ? "yes"
          : "no";
    measurements.push(
      `structure_passed=${job.structureReport.passed ? "yes" : "no"} frame_preserved=${framePreserved} image_fill_nodes=${job.structureReport.imageFillNodeCount} vector_nodes=${job.structureReport.vectorNodeCount} text_nodes=${job.structureReport.textNodeCount} inferred_text=${job.structureReport.inferredTextCount}`,
    );
  }

  return measurements;
}

function buildFindings(job) {
  const diffMetrics = job.diffMetrics;
  const failedGates = diffMetrics.acceptanceGates.filter((gate) => !gate.passed);
  const hardFailedGates = failedGates.filter((gate) => gate.hard);
  const findings = [];

  if (!failedGates.length) {
    findings.push("All acceptance gates passed for the current measured render.");
  } else if (hardFailedGates.length) {
    findings.push(`Hard acceptance gates still failing: ${hardFailedGates.map(formatGateSummary).join("; ")}`);
  } else {
    findings.push(`Only soft acceptance gates remain: ${failedGates.map(formatGateSummary).join("; ")}`);
  }

  if (job.structureReport?.issues?.length) {
    findings.push(`Structure report issues: ${job.structureReport.issues.join("; ")}`);
  } else if (job.structureReport?.passed) {
    findings.push("Structure report passed for the current render tree.");
  }

  if (job.refineSuggestions?.length) {
    const suggestion = job.refineSuggestions[0];
    findings.push(`Top refine suggestion: [${suggestion.kind}] ${suggestion.message}`);
  }

  if (job.stopReason) {
    findings.push(`Loop stop reason: ${job.stopReason}`);
  }

  return findings;
}

function buildFollowUp(job) {
  const diffMetrics = job.diffMetrics;
  const failedGates = diffMetrics.acceptanceGates.filter((gate) => !gate.passed);
  const followUp = [];

  if (failedGates.length || diffMetrics.compositeScore < 0.9) {
    followUp.push("Adjust one hotspot or failed-gate region, then rerun plugin:reconstruct -- --job <JOB_ID> --render and --measure.");
  } else {
    followUp.push("If the visible result also passes manual review, link this quality report from the related acceptance or release evidence.");
  }

  if (job.refineSuggestions?.length) {
    followUp.push(`Use the next targeted change from the top refine suggestion: ${job.refineSuggestions[0].message}`);
  }

  if (!job.refineSuggestions?.length && !failedGates.length) {
    followUp.push("Preserve the current measured output as the benchmark before the next workflow change.");
  }

  return followUp;
}

function buildSummary({
  timestamp,
  job,
  artifactPaths,
}) {
  const diffMetrics = job.diffMetrics;
  const failedGates = diffMetrics.acceptanceGates.filter((gate) => !gate.passed);
  const lines = [
    `timestamp: ${timestamp}`,
    `job: ${job.id}`,
    `strategy: ${job.input.strategy}`,
    `target: ${job.targetNode.name} [${job.targetNode.type}] id=${job.targetNode.id}`,
    `reference: ${job.referenceNode.name} [${job.referenceNode.type}] id=${job.referenceNode.id}`,
    `stage: ${job.currentStageId}`,
    `status: ${job.status}`,
    `applyStatus: ${job.applyStatus}`,
    `loopStatus: ${job.loopStatus}`,
    `composite: ${formatNumber(diffMetrics.compositeScore)}`,
    `grade: ${diffMetrics.grade}`,
    `failedGates: ${failedGates.length}`,
  ];

  if (failedGates.length) {
    lines.push("failedGateDetails:");
    for (const gate of failedGates) {
      lines.push(`- ${formatGateSummary(gate)}`);
    }
  }

  if (diffMetrics.hotspots.length) {
    lines.push("hotspots:");
    for (const hotspot of diffMetrics.hotspots.slice(0, 3)) {
      lines.push(`- ${hotspot.id}: score=${formatNumber(hotspot.score)} bounds=${formatBounds(hotspot.bounds)}`);
    }
  }

  if (job.structureReport?.issues?.length) {
    lines.push("structureIssues:");
    for (const issue of job.structureReport.issues) {
      lines.push(`- ${issue}`);
    }
  }

  if (job.refineSuggestions?.length) {
    lines.push("refineSuggestions:");
    for (const suggestion of job.refineSuggestions.slice(0, 3)) {
      lines.push(`- [${suggestion.kind}] ${suggestion.message}`);
    }
  }

  lines.push("artifacts:");
  for (const artifactPath of artifactPaths) {
    lines.push(`- ${artifactPath}`);
  }
  return `${lines.join("\n")}\n`;
}

function sortArtifacts(paths) {
  const rank = (artifactPath) => {
    if (artifactPath.endsWith("/quality-summary.txt")) {
      return 0;
    }
    if (artifactPath.endsWith("-snapshot.json")) {
      return 1;
    }
    if (artifactPath.endsWith("-reference.png")) {
      return 2;
    }
    if (artifactPath.endsWith("-rendered.png")) {
      return 3;
    }
    return 4;
  };

  return [...paths].sort((left, right) => {
    const leftRank = rank(left);
    const rightRank = rank(right);
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.localeCompare(right);
  });
}

async function writePreviewArtifact(artifactDirectory, reportArtifactRoot, jobId, suffix, dataUrl) {
  if (!dataUrl) {
    return null;
  }
  const decoded = decodeImageDataUrl(dataUrl, `${suffix} preview`);
  const filePath = path.join(artifactDirectory, `${sanitizeFileSegment(jobId)}-${suffix}.${decoded.extension}`);
  await writeFile(filePath, decoded.buffer);
  return path.join(reportArtifactRoot, path.basename(filePath));
}

async function main() {
  const jobId = readFlag(process.argv, "--job");
  if (!jobId) {
    fail("quality:prep requires --job <JOB_ID>.");
  }

  const job = await requestJson(`/api/reconstruction/jobs/${jobId}`);
  if (!job?.diffMetrics) {
    fail("Reconstruction job has no diff metrics yet. Run plugin:reconstruct -- --job <JOB_ID> --measure first.");
  }

  const timestamp = readFlag(process.argv, "--timestamp") || nowTimestamp();
  if (!/^[0-9]{8}-[0-9]{6}$/.test(timestamp)) {
    fail(`Invalid --timestamp: ${timestamp}`);
  }

  const owner = readFlag(process.argv, "--owner") || "TBD";
  const scope = readFlag(process.argv, "--scope") || "Reconstruction quality measurement";

  const { markdownPath, jsonPath } = resolveQualityReportPaths(qualityDirectory, timestamp);
  const artifactDirectory = path.join(reportRoot, "reports", "quality", "artifacts", timestamp);
  const reportArtifactRoot = path.join("reports", "quality", "artifacts", timestamp);

  await mkdir(qualityDirectory, { recursive: true });
  await ensureQualityReportDoesNotExist(markdownPath);
  await ensureQualityReportDoesNotExist(jsonPath);
  await mkdir(artifactDirectory, { recursive: true });

  const snapshotPath = path.join(artifactDirectory, `${sanitizeFileSegment(job.id)}-snapshot.json`);
  await writeFile(snapshotPath, `${JSON.stringify(job, null, 2)}\n`, "utf8");

  const referencePreviewDataUrl =
    job.referenceRaster?.dataUrl ||
    job.referenceNode?.previewDataUrl ||
    job.analysis?.previewDataUrl ||
    null;
  const renderedPreviewDataUrl = job.renderedPreview?.previewDataUrl || null;

  const artifactPaths = [
    path.join(reportArtifactRoot, path.basename(snapshotPath)),
  ];
  const referencePath = await writePreviewArtifact(
    artifactDirectory,
    reportArtifactRoot,
    job.id,
    "reference",
    referencePreviewDataUrl,
  );
  if (referencePath) {
    artifactPaths.push(referencePath);
  }
  const renderedPath = await writePreviewArtifact(
    artifactDirectory,
    reportArtifactRoot,
    job.id,
    "rendered",
    renderedPreviewDataUrl,
  );
  if (renderedPath) {
    artifactPaths.push(renderedPath);
  }

  const sortedArtifactsWithoutSummary = sortArtifacts(artifactPaths);
  const summaryPath = path.join(artifactDirectory, "quality-summary.txt");
  await writeFile(
    summaryPath,
    buildSummary({
      timestamp,
      job,
      artifactPaths: sortedArtifactsWithoutSummary,
    }),
    "utf8",
  );

  const payload = {
    kind: "quality_report",
    timestamp,
    scope,
    owner,
    inputs: [
      `reconstruction job ${job.id}`,
      `strategy ${job.input.strategy}`,
      `target ${job.targetNode.name} [${job.targetNode.type}] id=${job.targetNode.id}`,
      `reference ${job.referenceNode.name} [${job.referenceNode.type}] id=${job.referenceNode.id}`,
    ],
    measurements: buildMeasurements(job),
    findings: buildFindings(job),
    artifacts: sortArtifacts([
      path.join(reportArtifactRoot, path.basename(summaryPath)),
      ...artifactPaths,
    ]),
    follow_up: buildFollowUp(job),
  };

  await writeQualityReportFiles(qualityDirectory, payload);

  console.log(`[quality:prep] ready`);
  console.log(`[quality:prep] report: ${path.relative(reportRoot, markdownPath)}`);
  console.log(`[quality:prep] payload: ${path.relative(reportRoot, jsonPath)}`);
  console.log(`[quality:prep] summary: ${path.relative(reportRoot, summaryPath)}`);
  for (const artifactPath of payload.artifacts) {
    if (artifactPath.endsWith("/quality-summary.txt")) {
      continue;
    }
    console.log(`[quality:prep] artifact: ${artifactPath}`);
  }
  console.log("[quality:prep] next: open the runbook at reports/quality/RUNBOOK.md");
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(message);
  process.exitCode = 1;
});
