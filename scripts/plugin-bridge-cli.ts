import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  composePluginCommandsFromPrompt,
  type PluginCommandComposition,
} from "../shared/plugin-command-composer.js";
import type {
  PluginBridgeSession,
  PluginBridgeSnapshot,
  QueuePluginCommandPayload,
} from "../shared/plugin-bridge.js";
import type { FigmaPluginCommandBatch } from "../shared/plugin-contract.js";
import {
  collectCapabilityIds,
  collectMutatingCapabilityIds,
  prepareBatchForExternalDispatch,
} from "../shared/plugin-targeting.js";
import type {
  ApproveReconstructionPlanPayload,
  CreateReconstructionJobPayload,
  ReconstructionContextPack,
  ReconstructionJob,
  ReconstructionJobSnapshot,
  SubmitReconstructionAnalysisPayload,
  ReviewReconstructionAssetPayload,
  ReviewReconstructionFontPayload,
} from "../shared/reconstruction.js";

const BASE_URL =
  process.env.AUTODESIGN_API_URL ??
  process.env.FIGMATEST_API_URL ??
  "http://localhost:3001";

type Mode = "status" | "send" | "preview" | "inspect" | "reconstruct";
type PreviewTarget = {
  index: number;
  node: PluginBridgeSession["selection"][number];
};

function fail(message: string): never {
  throw new Error(message);
}

function parseMode(argv: string[]): Mode {
  const mode = argv[2];
  if (mode === "status" || mode === "send" || mode === "preview" || mode === "inspect") {
    return mode;
  }
  if (mode === "reconstruct") {
    return mode;
  }
  fail(
    "Usage: npm run plugin:status OR npm run plugin:inspect OR npm run plugin:send -- --prompt \"把当前选中对象改成粉色\" OR npm run plugin:preview OR npm run plugin:reconstruct",
  );
}

function readFlag(argv: string[], name: string) {
  const index = argv.indexOf(name);
  if (index < 0) {
    return null;
  }
  return argv[index + 1] ?? null;
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const fs = await import("node:fs/promises");
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

async function requestJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${pathname}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init && init.headers ? init.headers : {}),
      },
    });
  } catch (error) {
    fail(
      `Request failed: ${BASE_URL}${pathname} (${error instanceof Error ? error.message : "network error"})`,
    );
  }

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) {
        detail = `${detail} - ${payload.error}`;
      }
    } catch {
      // Ignore non-JSON error bodies.
    }
    fail(`Request failed: ${detail}`);
  }

  return (await response.json()) as T;
}

function sortSessions(sessions: PluginBridgeSession[]) {
  return [...sessions].sort((left, right) =>
    right.lastSeenAt.localeCompare(left.lastSeenAt),
  );
}

function pickSession(
  sessions: PluginBridgeSession[],
  explicitSessionId: string | null,
) {
  if (!sessions.length) {
    fail("当前没有在线插件会话。请先在 Figma 里打开 AutoDesign。");
  }

  if (explicitSessionId) {
    const found = sessions.find((session) => session.id === explicitSessionId);
    if (!found) {
      fail(`没有找到 session: ${explicitSessionId}`);
    }
    return found;
  }

  return sortSessions(sessions)[0];
}

function parseBatchFromArgs(argv: string[]) {
  const prompt = readFlag(argv, "--prompt");
  const json = readFlag(argv, "--json");

  if (prompt && json) {
    fail("只能使用一种输入方式：--prompt 或 --json。");
  }

  if (prompt) {
    const composition = composePluginCommandsFromPrompt(prompt);
    if (!composition.batch.commands.length) {
      fail(
        composition.warnings[0] || "没有生成任何插件命令。请调整描述后再试。",
      );
    }
    return {
      batch: composition.batch,
      composition,
    };
  }

  if (json) {
    let parsed: FigmaPluginCommandBatch;
    try {
      parsed = JSON.parse(json) as FigmaPluginCommandBatch;
    } catch (error) {
      fail(error instanceof Error ? `JSON 解析失败：${error.message}` : "JSON 解析失败。");
    }

    if (!Array.isArray(parsed.commands) || !parsed.commands.length) {
      fail("命令 JSON 里没有 commands。");
    }

    return {
      batch: parsed,
      composition: null,
    };
  }

  fail("send 模式必须提供 --prompt 或 --json。");
}

function printSelection(session: PluginBridgeSession) {
  if (!session.selection.length) {
    console.log("selection: empty");
    return;
  }

  for (const [index, node] of session.selection.entries()) {
    console.log(
      `- [${index}] ${node.name} [${node.type}] id=${node.id} fills=${node.fills.join(", ") || "none"} fillStyleId=${node.fillStyleId || "none"} size=${node.width ?? "?"}x${node.height ?? "?"} local=(${node.x ?? "?"}, ${node.y ?? "?"}) abs=(${node.absoluteX ?? "?"}, ${node.absoluteY ?? "?"}) parent=${node.parentNodeType || "none"}:${node.parentNodeId || "none"} parentLayout=${node.parentLayoutMode || "none"} layout=${node.layoutMode || "none"} positioning=${node.layoutPositioning || "none"}`,
    );
  }
}

function printCapabilities(session: PluginBridgeSession) {
  if (!session.capabilities.length) {
    console.log("capabilities: none");
  } else {
    console.log(
      `capabilities: ${session.capabilities.map((item) => item.id).join(", ")}`,
    );
  }
  console.log(
    `runtimeFeatures: explicitNodeTargeting=${session.runtimeFeatures?.supportsExplicitNodeTargeting ? "yes" : "no"}`,
  );
}

function parseNodeIds(nodeIdsRaw: string | null) {
  if (!nodeIdsRaw) {
    return [];
  }
  return nodeIdsRaw.split(",").map((id) => id.trim()).filter(Boolean);
}

function formatSelectionForTargeting(session: PluginBridgeSession) {
  if (!session.selection.length) {
    return "当前 selection 为空。";
  }

  return [
    "当前 selection:",
    ...session.selection.map(
      (node) => `- ${node.name} [${node.type}] id=${node.id}`,
    ),
  ].join("\n");
}

function ensureExplicitTargetingForMutations(
  batch: FigmaPluginCommandBatch,
  session: PluginBridgeSession,
  nodeIds: string[],
) {
  const mutatingCapabilityIds = collectMutatingCapabilityIds(batch);
  if (!mutatingCapabilityIds.length) {
    return;
  }

  if (!session.runtimeFeatures?.supportsExplicitNodeTargeting) {
    fail("目标插件当前不支持显式 nodeIds 定向，已拒绝发送修改类外部命令。");
  }

  if (!nodeIds.length) {
    fail(
      [
        `修改类外部命令必须提供 --node-ids。涉及能力：${mutatingCapabilityIds.join(", ")}`,
        '示例：npm run plugin:send -- --prompt "把指定对象改成深灰色" --node-ids 1:2',
        formatSelectionForTargeting(session),
      ].join("\n"),
    );
  }
}

function printComposition(composition: PluginCommandComposition | null) {
  if (!composition) {
    return;
  }

  if (composition.notes.length) {
    console.log("notes:");
    for (const note of composition.notes) {
      console.log(`- ${note}`);
    }
  }

  if (composition.warnings.length) {
    console.log("warnings:");
    for (const warning of composition.warnings) {
      console.log(`- ${warning}`);
    }
  }
}

function printReconstructionJob(job: ReconstructionJob) {
  console.log(`job: ${job.id}`);
  console.log(`session: ${job.input.targetSessionId}`);
  console.log(`strategy: ${job.input.strategy}`);
  console.log(`status: ${job.status}`);
  console.log(`applyStatus: ${job.applyStatus}`);
  console.log(`loopStatus: ${job.loopStatus}`);
  console.log(`stopReason: ${job.stopReason || "none"}`);
  console.log(`approvalState: ${job.approvalState}`);
  console.log(`analysisVersion: ${job.analysisVersion}`);
  console.log(`analysisProvider: ${job.analysisProvider}`);
  console.log(`goal: ${job.input.goal}`);
  console.log(`current stage: ${job.currentStageId}`);
  console.log(`target: ${job.targetNode.name} [${job.targetNode.type}] id=${job.targetNode.id}`);
  console.log(
    `reference: ${job.referenceNode.name} [${job.referenceNode.type}] id=${job.referenceNode.id}`,
  );
  if (job.referenceRaster) {
    console.log(
      `referenceRaster: ${job.referenceRaster.width}x${job.referenceRaster.height} | ${job.referenceRaster.mimeType} | ${job.referenceRaster.source}`,
    );
  }
  console.log(`allowOutpainting: ${job.input.allowOutpainting}`);
  console.log(`maxIterations: ${job.input.maxIterations}`);
  console.log(`iterationCount: ${job.iterationCount}`);
  console.log(`bestDiffScore: ${job.bestDiffScore === null ? "none" : job.bestDiffScore.toFixed(4)}`);
  console.log(
    `lastImprovement: ${job.lastImprovement === null ? "none" : job.lastImprovement.toFixed(4)}`,
  );
  console.log(`stagnationCount: ${job.stagnationCount}`);
  console.log(`appliedNodeIds: ${job.appliedNodeIds.length}`);
  if (job.warnings.length) {
    console.log("warnings:");
    for (const warning of job.warnings) {
      console.log(`- ${warning}`);
    }
  }
  if (job.analysis) {
    console.log(
      `analysis: ${job.analysis.width}x${job.analysis.height} | colors=${job.analysis.dominantColors.join(", ") || "none"} | regions=${job.analysis.layoutRegions.length} | surfaces=${job.analysis.designSurfaces.length} | primitives=${job.analysis.vectorPrimitives.length} | textCandidates=${job.analysis.textCandidates.length} | textBlocks=${job.analysis.textBlocks.length} | ocrBlocks=${job.analysis.ocrBlocks.length} | assetCandidates=${job.analysis.assetCandidates.length}`,
    );
    if (job.analysis.canonicalFrame) {
      console.log(
        `canonicalFrame: ${job.analysis.canonicalFrame.width}x${job.analysis.canonicalFrame.height} | fixed=${job.analysis.canonicalFrame.fixedTargetFrame ? "yes" : "no"} | deprojected=${job.analysis.canonicalFrame.deprojected ? "yes" : "no"}`,
      );
    }
    if (job.analysis.completionZones.length) {
      console.log("completionZones:");
      for (const zone of job.analysis.completionZones) {
        console.log(
          `- ${zone.id}: reason=${zone.reason} bounds=(${zone.bounds.x}, ${zone.bounds.y}, ${zone.bounds.width}, ${zone.bounds.height})`,
        );
      }
    }
    if (job.analysis.deprojectionNotes.length) {
      console.log("deprojectionNotes:");
      for (const note of job.analysis.deprojectionNotes) {
        console.log(`- ${note.id}: ${note.message}${note.targetId ? ` | target=${note.targetId}` : ""}`);
      }
    }
    if (job.analysis.textBlocks.length) {
      console.log("textBlocks:");
      for (const block of job.analysis.textBlocks) {
        console.log(
          `- ${block.id}: role=${block.role} inferred=${block.inferred ? "yes" : "no"} content=${block.content || "[missing]"}`,
        );
      }
    }
    if (job.analysis.ocrBlocks.length) {
      console.log("ocrBlocks:");
      for (const block of job.analysis.ocrBlocks) {
        console.log(
          `- ${block.id}: text=${block.text || "[missing]"} confidence=${block.confidence.toFixed(2)} source=${block.source}`,
        );
      }
    }
    if (job.analysis.textStyleHints.length) {
      console.log("textStyleHints:");
      for (const hint of job.analysis.textStyleHints) {
        console.log(
          `- ${hint.textCandidateId}: role=${hint.role} fontCategory=${hint.fontCategory} fontSizeEstimate=${hint.fontSizeEstimate ?? "none"} color=${hint.colorHex || "none"}`,
        );
      }
    }
    if (job.analysis.assetCandidates.length) {
      console.log("assetCandidates:");
      for (const asset of job.analysis.assetCandidates) {
        console.log(
          `- ${asset.id}: kind=${asset.kind} mode=${asset.extractMode} outpaint=${asset.needsOutpainting ? "yes" : "no"} confidence=${asset.confidence.toFixed(2)}`,
        );
      }
    }
  }
  if (job.fontMatches.length) {
    console.log("fontMatches:");
    for (const match of job.fontMatches) {
      console.log(
        `- ${match.textCandidateId}: ${match.recommended} (${match.candidates.join(", ")})`,
      );
    }
  }
  if (job.rebuildPlan) {
    console.log("rebuildPlan:");
    for (const summary of job.rebuildPlan.summary) {
      console.log(`- ${summary}`);
    }
    console.log(`ops: ${job.rebuildPlan.ops.length}`);
  }
  if (job.reviewFlags.length) {
    console.log("reviewFlags:");
    for (const flag of job.reviewFlags) {
      console.log(`- [${flag.severity}] ${flag.kind}: ${flag.message}`);
    }
  }
  if (job.approvedFontChoices.length) {
    console.log("approvedFontChoices:");
    for (const item of job.approvedFontChoices) {
      console.log(`- ${item.textCandidateId}: ${item.fontFamily}`);
    }
  }
  if (job.approvedAssetChoices.length) {
    console.log("approvedAssetChoices:");
    for (const item of job.approvedAssetChoices) {
      console.log(`- ${item.assetId}: ${item.decision}${item.note ? ` | ${item.note}` : ""}`);
    }
  }
  if (job.renderedPreview) {
    console.log(
      `renderedPreview: ${job.renderedPreview.width}x${job.renderedPreview.height} | ${job.renderedPreview.mimeType}`,
    );
  }
  if (job.diffMetrics) {
    console.log(
      `diffMetrics: global=${job.diffMetrics.globalSimilarity.toFixed(4)} layout=${job.diffMetrics.layoutSimilarity.toFixed(4)} edge=${job.diffMetrics.edgeSimilarity.toFixed(4)} colorDelta=${job.diffMetrics.colorDelta.toFixed(4)}`,
    );
    if (job.diffMetrics.hotspots.length) {
      console.log("hotspots:");
      for (const hotspot of job.diffMetrics.hotspots) {
        console.log(
          `- ${hotspot.id}: score=${hotspot.score.toFixed(4)} bounds=(${hotspot.bounds.x}, ${hotspot.bounds.y}, ${hotspot.bounds.width}, ${hotspot.bounds.height})`,
        );
      }
    }
  }
  if (job.structureReport) {
    console.log(
      `structureReport: passed=${job.structureReport.passed ? "yes" : "no"} | framePreserved=${job.structureReport.targetFramePreserved === null ? "unknown" : job.structureReport.targetFramePreserved ? "yes" : "no"} | imageFillNodes=${job.structureReport.imageFillNodeCount} | vectorNodes=${job.structureReport.vectorNodeCount} | textNodes=${job.structureReport.textNodeCount} | inferredText=${job.structureReport.inferredTextCount}`,
    );
    if (job.structureReport.issues.length) {
      console.log("structureIssues:");
      for (const issue of job.structureReport.issues) {
        console.log(`- ${issue}`);
      }
    }
  }
  if (job.refineSuggestions.length) {
    console.log("refineSuggestions:");
    for (const suggestion of job.refineSuggestions) {
      console.log(`- [${suggestion.kind}] ${suggestion.message}`);
    }
  }
  console.log("stages:");
  for (const stage of job.stages) {
    console.log(`- ${stage.stageId}: ${stage.status}${stage.message ? ` | ${stage.message}` : ""}`);
  }
}

function sanitizeFileSegment(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "selection";
}

function decodeDataUrl(dataUrl: string) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    fail("无效的 data URL。");
  }

  const mimeType = match[1];
  const buffer = Buffer.from(match[2], "base64");
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : "img";
  return { mimeType, buffer, extension };
}

async function writeContextPackArtifacts(
  contextPack: ReconstructionContextPack,
  outputDirectory: string,
) {
  await mkdir(outputDirectory, { recursive: true });
  const baseName = sanitizeFileSegment(contextPack.jobId);
  const contextPath = path.join(outputDirectory, `${baseName}-context-pack.json`);
  await writeFile(contextPath, JSON.stringify(contextPack, null, 2), "utf8");

  const referencePreview = decodeDataUrl(contextPack.referencePreviewDataUrl);
  const referencePreviewPath = path.join(outputDirectory, `${baseName}-reference.${referencePreview.extension}`);
  await writeFile(referencePreviewPath, referencePreview.buffer);

  let targetPreviewPath: string | null = null;
  if (contextPack.targetPreviewDataUrl) {
    const targetPreview = decodeDataUrl(contextPack.targetPreviewDataUrl);
    targetPreviewPath = path.join(outputDirectory, `${baseName}-target.${targetPreview.extension}`);
    await writeFile(targetPreviewPath, targetPreview.buffer);
  }

  return {
    contextPath,
    referencePreviewPath,
    targetPreviewPath,
  };
}

function parsePreviewDataUrl(node: PluginBridgeSession["selection"][number]) {
  if (!node.previewDataUrl) {
    fail(`节点 ${node.name} 当前没有可用预览。请重新打开插件并重新选中图片后再试。`);
  }

  const match = /^data:image\/png;base64,(.+)$/.exec(node.previewDataUrl);
  if (!match) {
    fail(`节点 ${node.name} 的预览数据格式无效。`);
  }

  return Buffer.from(match[1], "base64");
}

function pickPreviewTargets(
  session: PluginBridgeSession,
  explicitIndex: string | null,
): PreviewTarget[] {
  const previewable = session.selection
    .map((node, index) => ({
      index,
      node,
    }))
    .filter((entry) => Boolean(entry.node.previewDataUrl));

  if (!previewable.length) {
    fail("当前 selection 没有可导出的预览。请重新打开插件并选中图片节点。");
  }

  if (explicitIndex === null) {
    return previewable;
  }

  const index = Number.parseInt(explicitIndex, 10);
  if (Number.isNaN(index)) {
    fail(`无效的 --index: ${explicitIndex}`);
  }

  const target = previewable.find((entry) => entry.index === index);
  if (!target) {
    fail(`selection 中不存在 index=${index} 的可预览节点。`);
  }

  return [target];
}

async function runStatus() {
  const snapshot = await requestJson<PluginBridgeSnapshot>("/api/plugin-bridge");
  const sessions = sortSessions(snapshot.sessions);

  if (!sessions.length) {
    console.log("当前没有在线插件会话。");
    return;
  }

  for (const session of sessions) {
    console.log(
      `${session.id} | ${session.label} ${session.pluginVersion} | ${session.status} | ${session.fileName} / ${session.pageName}`,
    );
    printCapabilities(session);
    printSelection(session);
  }
}

async function runSend(argv: string[]) {
  const snapshot = await requestJson<PluginBridgeSnapshot>("/api/plugin-bridge");
  const session = pickSession(snapshot.sessions, readFlag(argv, "--session"));
  const { batch: rawBatch, composition } = parseBatchFromArgs(argv);
  const nodeIds = parseNodeIds(readFlag(argv, "--node-ids"));
  ensureExplicitTargetingForMutations(rawBatch, session, nodeIds);
  const batch = prepareBatchForExternalDispatch(rawBatch, nodeIds);
  const payload: QueuePluginCommandPayload = {
    targetSessionId: session.id,
    source: "codex",
    payload: batch,
  };
  const batchCapabilityIds = collectCapabilityIds(batch);
  const availableCapabilities = new Set(session.capabilities.map((item) => item.id));
  const unsupportedCapabilities = batchCapabilityIds.filter(
    (capabilityId) => !availableCapabilities.has(capabilityId),
  );

  if (unsupportedCapabilities.length) {
    fail(`目标插件当前不支持这些能力：${unsupportedCapabilities.join(", ")}`);
  }

  const result = await requestJson<{ id: string }>(
    "/api/plugin-bridge/commands",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );

  console.log(`queued: ${result.id}`);
  console.log(`session: ${session.id}`);
  console.log(`target: ${session.fileName} / ${session.pageName}`);
  printCapabilities(session);
  printSelection(session);
  printComposition(composition);
  console.log("payload:");
  console.log(JSON.stringify(batch, null, 2));
}

async function runPreview(argv: string[]) {
  const snapshot = await requestJson<PluginBridgeSnapshot>("/api/plugin-bridge");
  const session = pickSession(snapshot.sessions, readFlag(argv, "--session"));
  const targets = pickPreviewTargets(session, readFlag(argv, "--index"));
  const outputDirectory =
    readFlag(argv, "--out") || path.join(process.cwd(), "data", "plugin-previews");

  await mkdir(outputDirectory, { recursive: true });

  for (const target of targets) {
    const fileName = `${session.id}-${target.index}-${sanitizeFileSegment(target.node.name)}.png`;
    const filePath = path.join(outputDirectory, fileName);
    await writeFile(filePath, parsePreviewDataUrl(target.node));
    console.log(filePath);
  }
}

async function runInspect(argv: string[]) {
  const snapshot = await requestJson<PluginBridgeSnapshot>("/api/plugin-bridge");
  const session = pickSession(snapshot.sessions, readFlag(argv, "--session"));
  console.log(
    `${session.id} | ${session.label} ${session.pluginVersion} | ${session.status} | ${session.fileName} / ${session.pageName}`,
  );
  printCapabilities(session);
  printSelection(session);

  const outputDirectory =
    readFlag(argv, "--out") || path.join(process.cwd(), "data", "plugin-previews");
  const targets = pickPreviewTargets(session, readFlag(argv, "--index"));

  await mkdir(outputDirectory, { recursive: true });
  console.log("previews:");
  for (const target of targets) {
    const fileName = `${session.id}-${target.index}-${sanitizeFileSegment(target.node.name)}.png`;
    const filePath = path.join(outputDirectory, fileName);
    await writeFile(filePath, parsePreviewDataUrl(target.node));
    console.log(`- [${target.index}] ${filePath}`);
  }
}

async function runReconstruct(argv: string[]) {
  const jobId = readFlag(argv, "--job");
  if (jobId) {
    if (argv.includes("--analyze")) {
      const job = await requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/analyze`, {
        method: "POST",
      });
      printReconstructionJob(job);
      return;
    }
    if (argv.includes("--context-pack")) {
      const contextPack = await requestJson<ReconstructionContextPack>(
        `/api/reconstruction/jobs/${jobId}/context-pack`,
        {
          method: "POST",
        },
      );
      const outputDirectory =
        readFlag(argv, "--out") || path.join(process.cwd(), "data", "reconstruction-context-packs");
      const artifacts = await writeContextPackArtifacts(contextPack, outputDirectory);
      console.log(`job: ${contextPack.jobId}`);
      console.log(`mode: ${contextPack.mode}`);
      console.log(`contextPack: ${artifacts.contextPath}`);
      console.log(`referencePreview: ${artifacts.referencePreviewPath}`);
      console.log(`targetPreview: ${artifacts.targetPreviewPath || "none"}`);
      console.log("guidance:");
      for (const line of contextPack.guidance) {
        console.log(`- ${line}`);
      }
      return;
    }
    if (argv.includes("--submit-analysis")) {
      const analysisFile = readFlag(argv, "--analysis-file");
      const analysisJson = readFlag(argv, "--analysis-json");
      if (!analysisFile && !analysisJson) {
        fail("--submit-analysis 需要 --analysis-file 或 --analysis-json。");
      }
      if (analysisFile && analysisJson) {
        fail("--submit-analysis 只能使用一种输入方式：--analysis-file 或 --analysis-json。");
      }
      const payload = analysisFile
        ? await readJsonFile<SubmitReconstructionAnalysisPayload>(analysisFile)
        : (JSON.parse(analysisJson as string) as SubmitReconstructionAnalysisPayload);
      const job = await requestJson<ReconstructionJob>(
        `/api/reconstruction/jobs/${jobId}/submit-analysis`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
      printReconstructionJob(job);
      return;
    }
    if (argv.includes("--preview-plan")) {
      const job = await requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/preview-plan`, {
        method: "POST",
      });
      printReconstructionJob(job);
      return;
    }
    if (argv.includes("--review-font")) {
      const textCandidateId = readFlag(argv, "--text-candidate");
      const fontFamily = readFlag(argv, "--font");
      if (!textCandidateId || !fontFamily) {
        fail("--review-font 需要 --text-candidate 和 --font。");
      }
      const payload: ReviewReconstructionFontPayload = { textCandidateId, fontFamily };
      const job = await requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/review/font`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      printReconstructionJob(job);
      return;
    }
    if (argv.includes("--review-asset")) {
      const assetId = readFlag(argv, "--asset");
      const decision = readFlag(argv, "--decision");
      if (!assetId || (decision !== "approved" && decision !== "rejected")) {
        fail("--review-asset 需要 --asset 和 --decision approved|rejected。");
      }
      const payload: ReviewReconstructionAssetPayload = {
        assetId,
        decision,
        note: readFlag(argv, "--note") || undefined,
      };
      const job = await requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/review/asset`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      printReconstructionJob(job);
      return;
    }
    if (argv.includes("--approve-plan") || argv.includes("--request-changes")) {
      const payload: ApproveReconstructionPlanPayload = {
        approved: argv.includes("--approve-plan"),
        note: readFlag(argv, "--note") || undefined,
      };
      const job = await requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/review/approve-plan`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      printReconstructionJob(job);
      return;
    }
    if (argv.includes("--apply")) {
      const job = await requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/apply`, {
        method: "POST",
      });
      printReconstructionJob(job);
      return;
    }
    if (argv.includes("--clear")) {
      const job = await requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/clear`, {
        method: "POST",
      });
      printReconstructionJob(job);
      return;
    }
    if (argv.includes("--render")) {
      const job = await requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/render`, {
        method: "POST",
      });
      printReconstructionJob(job);
      return;
    }
    if (argv.includes("--measure")) {
      const job = await requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/measure`, {
        method: "POST",
      });
      printReconstructionJob(job);
      return;
    }
    if (argv.includes("--refine")) {
      const job = await requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/refine`, {
        method: "POST",
      });
      printReconstructionJob(job);
      return;
    }
    if (argv.includes("--iterate")) {
      const job = await requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/iterate`, {
        method: "POST",
      });
      printReconstructionJob(job);
      return;
    }
    if (argv.includes("--loop")) {
      const job = await requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/loop`, {
        method: "POST",
      });
      printReconstructionJob(job);
      return;
    }
    const job = await requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}`);
    printReconstructionJob(job);
    return;
  }

  if (argv.includes("--list")) {
    const snapshot = await requestJson<ReconstructionJobSnapshot>("/api/reconstruction/jobs");
    if (!snapshot.jobs.length) {
      console.log("当前没有 reconstruction job。");
      return;
    }

    for (const job of snapshot.jobs) {
      console.log(
        `${job.id} | ${job.status} | ${job.targetNode.name} <= ${job.referenceNode.name} | ${job.currentStageId}`,
      );
    }
    return;
  }

  const snapshot = await requestJson<PluginBridgeSnapshot>("/api/plugin-bridge");
  const session = pickSession(snapshot.sessions, readFlag(argv, "--session"));
  const maxIterationsRaw = readFlag(argv, "--max-iterations");
  const payload: CreateReconstructionJobPayload = {
    targetSessionId: session.id,
    targetNodeId: readFlag(argv, "--target") || undefined,
    referenceNodeId: readFlag(argv, "--reference") || undefined,
    goal: "pixel-match",
    maxIterations:
      maxIterationsRaw !== null ? Number.parseInt(maxIterationsRaw, 10) : undefined,
    allowOutpainting: argv.includes("--allow-outpainting"),
  };

  const job = await requestJson<ReconstructionJob>("/api/reconstruction/jobs", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  printReconstructionJob(job);
  if (job.input.strategy === "raster-exact") {
    console.log("next: --apply -> --render -> --measure");
  } else if (job.input.strategy === "vector-reconstruction") {
    console.log("next: --analyze -> --context-pack -> --submit-analysis -> --apply -> --render -> --measure");
  } else {
    console.log("next: --analyze or --context-pack");
  }
}

void (async () => {
  const mode = parseMode(process.argv);
  if (mode === "status") {
    await runStatus();
    return;
  }

  if (mode === "preview") {
    await runPreview(process.argv);
    return;
  }

  if (mode === "inspect") {
    await runInspect(process.argv);
    return;
  }

  if (mode === "reconstruct") {
    await runReconstruct(process.argv);
    return;
  }

  await runSend(process.argv);
})().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(message);
  process.exitCode = 1;
});
