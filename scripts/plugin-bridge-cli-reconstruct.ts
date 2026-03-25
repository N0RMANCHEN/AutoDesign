import { mkdir } from "node:fs/promises";
import path from "node:path";

import { parseReconstructionStrategy } from "../shared/plugin-cli-guards.js";
import type { InspectFrameResponsePayload, PluginBridgeSession, PluginBridgeSnapshot } from "../shared/plugin-bridge.js";
import type {
  ApproveReconstructionPlanPayload,
  CreateReconstructionJobPayload,
  ReconstructionContextPack,
  ReconstructionElement,
  ReconstructionElementScore,
  ReconstructionElementScoresPayload,
  ReconstructionElementScoresResponse,
  ReconstructionGuideManifest,
  ReconstructionJob,
  ReconstructionJobSnapshot,
  ReviewReconstructionAssetPayload,
  ReviewReconstructionFontPayload,
  SubmitReconstructionAnalysisPayload,
} from "../shared/reconstruction.js";
import {
  estimateSourceQuadPixels,
  parseSourceQuadPixels,
  sanitizeFileSegment,
  writeRemapPreview,
} from "./plugin-bridge-cli-reconstruct-analysis-io.js";
import {
  writeHybridAnalysisDraft,
  writeVectorAnalysisDraft,
} from "./plugin-bridge-cli-reconstruct-analysis.js";
import {
  cropDataUrlToFile,
  inspectFramePayload,
  printElementScores,
  printReconstructionJob,
  resolveElementQuery,
  writeContextPackArtifacts,
  writeGuideArtifacts,
} from "./plugin-bridge-cli-reconstruct-output.js";

type ReconstructCliDeps = {
  readFlag: (argv: string[], name: string) => string | null;
  readValueFlag: (argv: string[], name: string) => string | null;
  readJsonFile: <T>(filePath: string) => Promise<T>;
  requestJson: <T>(pathname: string, init?: RequestInit) => Promise<T>;
  pickSession: (sessions: PluginBridgeSession[], explicitSessionId: string | null) => PluginBridgeSession;
};

type ReconstructionExecutionAction = "apply" | "measure" | "refine" | "iterate" | "loop";

function fail(message: string): never {
  throw new Error(message);
}

function getBlockedExecutionActionMessage(
  job: ReconstructionJob,
  action: ReconstructionExecutionAction,
): string | null {
  if (action === "apply") {
    if (job.input.strategy !== "raster-exact" && !job.rebuildPlan) {
      return "Reconstruction job has no rebuild plan yet";
    }
    if (job.input.strategy !== "raster-exact" && job.approvalState !== "approved") {
      return `Reconstruction job must be approved before apply. current approvalState=${job.approvalState}`;
    }
    return null;
  }

  if (action === "measure") {
    if (!job.renderedPreview?.previewDataUrl) {
      return "Reconstruction job has no rendered preview yet.";
    }
    return null;
  }

  if (action === "refine") {
    if (job.input.strategy === "raster-exact") {
      return "raster-exact job 不支持 refine。请直接使用 render + measure 进行验收。";
    }
    if (job.input.strategy === "vector-reconstruction") {
      return "vector-reconstruction 目前不支持自动 refine。请重新提交 analysis 后再 apply/render/measure。";
    }
    if (job.input.strategy === "hybrid-reconstruction") {
      return "hybrid-reconstruction 当前先支持 apply/render/measure，暂不支持自动 refine。";
    }
    if (!job.diffMetrics) {
      return "Reconstruction job has no diff metrics yet.";
    }
    return null;
  }

  if (action === "iterate") {
    if (job.input.strategy === "raster-exact") {
      return "raster-exact job 不支持 iterate。请直接使用 render + measure。";
    }
    if (job.input.strategy === "vector-reconstruction") {
      return "vector-reconstruction 目前不支持 iterate。请修改 analysis/rebuild plan 后重新 apply。";
    }
    if (job.input.strategy === "hybrid-reconstruction") {
      return "hybrid-reconstruction 当前暂不支持 iterate。请重新提交 analysis 后再 apply/render/measure。";
    }
    if (!job.analysis) {
      return "Reconstruction job has no analysis yet";
    }
    if (job.applyStatus !== "applied") {
      return "Reconstruction job must be applied before running diff iteration";
    }
    return null;
  }

  if (job.input.strategy === "raster-exact") {
    return "raster-exact job 不支持自动 refine loop。";
  }
  if (job.input.strategy === "vector-reconstruction") {
    return "vector-reconstruction 目前不支持自动 refine loop。";
  }
  if (job.input.strategy === "hybrid-reconstruction") {
    return "hybrid-reconstruction 当前暂不支持自动 refine loop。";
  }
  if (!job.analysis) {
    return "Reconstruction job has no analysis yet";
  }
  if (job.applyStatus !== "applied") {
    return "Reconstruction job must be applied before running auto refine loop";
  }
  return null;
}

export async function runReconstruct(argv: string[], deps: ReconstructCliDeps) {
  const jobId = deps.readFlag(argv, "--job");
  if (jobId) {
    if (argv.includes("--preview-remap") || argv.includes("--draft-analysis") || argv.includes("--estimate-quad")) {
      const job = await deps.requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}`);
      const outputDirectory = deps.readFlag(argv, "--out") || path.join(process.cwd(), "data", "reconstruction-remaps");
      await mkdir(outputDirectory, { recursive: true });
      const explicitSourceQuad = parseSourceQuadPixels(deps.readFlag(argv, "--source-quad-px"));
      const shouldEstimateSourceQuad = argv.includes("--estimate-quad");
      const estimated =
        explicitSourceQuad.length === 4 || !shouldEstimateSourceQuad
          ? null
          : await estimateSourceQuadPixels(job, outputDirectory);
      const sourceQuadPixels = explicitSourceQuad.length === 4 ? explicitSourceQuad : estimated?.sourceQuadPixels || [];

      if (!sourceQuadPixels.length) {
        fail("无法获得 sourceQuad。请提供 --source-quad-px，或使用 --estimate-quad。");
      }

      console.log(`job: ${job.id}`);
      console.log(`sourceQuadPx: ${sourceQuadPixels.map((point) => `${point.x},${point.y}`).join(" | ")}`);
      if (estimated) {
        console.log(`estimatedRotation: ${estimated.rotationDegrees}deg`);
        console.log(`estimatedRotatedBox: (${estimated.rotatedBox.x}, ${estimated.rotatedBox.y}, ${estimated.rotatedBox.width}, ${estimated.rotatedBox.height}) density=${estimated.rotatedBox.density}`);
        if (estimated.debug?.originalOverlayPath) {
          console.log(`quadOverlay: ${estimated.debug.originalOverlayPath}`);
        }
        if (estimated.debug?.rotatedOverlayPath) {
          console.log(`rotatedBoxOverlay: ${estimated.debug.rotatedOverlayPath}`);
        }
      }

      const needsRemapPreview =
        argv.includes("--preview-remap") ||
        argv.includes("--draft-analysis") ||
        job.input.strategy === "vector-reconstruction";
      const remapPreviewPath = needsRemapPreview
        ? await writeRemapPreview(job, sourceQuadPixels, outputDirectory)
        : null;
      if (remapPreviewPath) {
        console.log(`remapPreview: ${remapPreviewPath}`);
      }
      if (argv.includes("--draft-analysis")) {
        if (!remapPreviewPath) {
          fail("draft-analysis 需要 remap preview，但当前没有生成成功。");
        }
        const draftPath =
          job.input.strategy === "vector-reconstruction"
            ? await writeVectorAnalysisDraft(job, sourceQuadPixels, remapPreviewPath, outputDirectory)
            : await writeHybridAnalysisDraft(job, sourceQuadPixels, remapPreviewPath, outputDirectory);
        console.log(`analysisDraft: ${draftPath}`);
      }
      return;
    }

    if (argv.includes("--export-guides")) {
      const job = await deps.requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}`);
      if (!job.analysis) {
        fail("Reconstruction job has no structured analysis yet.");
      }
      const manifest = await deps.requestJson<ReconstructionGuideManifest>(`/api/reconstruction/jobs/${jobId}/guide-manifest`);
      const outputDirectory = deps.readFlag(argv, "--out") || path.join(process.cwd(), "data", "reconstruction-guides");
      const artifacts = await writeGuideArtifacts(manifest, outputDirectory);
      console.log(`job: ${manifest.jobId}`);
      console.log(`guideManifest: ${artifacts.manifestPath}`);
      console.log(`referenceGuide: ${artifacts.referencePreviewPath || "none"}`);
      console.log(`rectifiedGuide: ${artifacts.rectifiedPreviewPath || "none"}`);
      console.log(`renderedGuide: ${artifacts.renderedPreviewPath || "none"}`);
      console.log(`elements: ${artifacts.elementCount}`);
      console.log(`constraints: ${artifacts.constraintCount}`);
      return;
    }

    const scoreElementQuery = deps.readValueFlag(argv, "--score-element");
    if (argv.includes("--score-elements") || argv.includes("--score-element") || scoreElementQuery) {
      const job = await deps.requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}`);
      if (!job.analysis) {
        fail("Reconstruction job has no structured analysis yet");
      }
      const manifest = await deps.requestJson<ReconstructionGuideManifest>(`/api/reconstruction/jobs/${jobId}/guide-manifest`);
      const inspectPayload = await inspectFramePayload(deps.requestJson, job.input.targetSessionId, job.targetNode.id, {
        maxDepth: (() => {
          const raw = deps.readFlag(argv, "--max-depth");
          const value = raw ? Number.parseInt(raw, 10) : Number.NaN;
          return Number.isFinite(value) ? value : 6;
        })(),
        includePreview: true,
      });
      const explicitElementQuery = scoreElementQuery || deps.readValueFlag(argv, "--element");
      const targetElement = explicitElementQuery ? resolveElementQuery(manifest.elements, explicitElementQuery) : null;
      if (explicitElementQuery && !targetElement) {
        fail(`未找到元素：${explicitElementQuery}`);
      }
      const renderedPreviewDataUrl = inspectPayload.preview?.dataUrl || job.renderedPreview?.previewDataUrl || null;
      if (!renderedPreviewDataUrl) {
        fail(`job ${job.id} 缺少当前 target render。先运行 --render，或保持插件在线以便 inspect-frame 导出预览。`);
      }
      const scorePayload: ReconstructionElementScoresPayload = {
        inspectedNodes: inspectPayload.nodes,
        renderedPreviewDataUrl,
        ...(targetElement ? { elementIds: [targetElement.id] } : {}),
      };
      const scoreResponse = await deps.requestJson<ReconstructionElementScoresResponse>(`/api/reconstruction/jobs/${jobId}/element-scores`, {
        method: "POST",
        body: JSON.stringify(scorePayload),
      });
      console.log(`job: ${job.id}`);
      console.log(`referencePreview: ${scoreResponse.referencePreviewKind}`);
      console.log(`liveNodes: ${scoreResponse.liveNodeCount}`);
      printElementScores(scoreResponse.scores);
      return;
    }

    const renderElementQuery = deps.readValueFlag(argv, "--render-element");
    if (argv.includes("--render-element") || renderElementQuery) {
      const explicitQuery = renderElementQuery || deps.readValueFlag(argv, "--element");
      if (!explicitQuery) {
        fail("--render-element 需要一个元素 id/name，或配合 --element 使用。");
      }
      const job = await deps.requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}`);
      if (!job.analysis) {
        fail("Reconstruction job has no structured analysis yet.");
      }
      const manifest = await deps.requestJson<ReconstructionGuideManifest>(`/api/reconstruction/jobs/${jobId}/guide-manifest`);
      const element = resolveElementQuery(manifest.elements, explicitQuery);
      if (!element) {
        fail(`未找到元素：${explicitQuery}`);
      }
      const referencePreviewDataUrl = manifest.images.rectifiedPreviewDataUrl || manifest.images.referencePreviewDataUrl;
      if (!referencePreviewDataUrl) {
        fail(`job ${job.id} 缺少 reference preview，无法导出元素 crop。`);
      }
      const inspectPayload = await inspectFramePayload(deps.requestJson, job.input.targetSessionId, job.targetNode.id, {
        maxDepth: 1,
        includePreview: true,
      });
      const renderedPreviewDataUrl = inspectPayload.preview?.dataUrl || job.renderedPreview?.previewDataUrl || null;
      if (!renderedPreviewDataUrl) {
        fail(`job ${job.id} 缺少当前 target render。先运行 --render，或保持插件在线以便 inspect-frame 导出预览。`);
      }
      const outputDirectory = deps.readFlag(argv, "--out") || path.join(process.cwd(), "data", "reconstruction-element-renders");
      await mkdir(outputDirectory, { recursive: true });
      const baseName = `${sanitizeFileSegment(job.id)}-${sanitizeFileSegment(element.name)}`;
      const referencePath = path.join(outputDirectory, `${baseName}-reference.png`);
      const renderedPath = path.join(outputDirectory, `${baseName}-rendered.png`);
      await cropDataUrlToFile(referencePreviewDataUrl, element.referenceBounds, referencePath);
      await cropDataUrlToFile(renderedPreviewDataUrl, element.referenceBounds, renderedPath);
      console.log(`job: ${job.id}`);
      console.log(`element: ${element.name} [${element.id}]`);
      console.log(`referenceCrop: ${referencePath}`);
      console.log(`renderedCrop: ${renderedPath}`);
      return;
    }

    if (argv.includes("--analyze")) {
      const job = await deps.requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/analyze`, { method: "POST" });
      printReconstructionJob(job);
      return;
    }

    if (argv.includes("--context-pack")) {
      const contextPack = await deps.requestJson<ReconstructionContextPack>(`/api/reconstruction/jobs/${jobId}/context-pack`, { method: "POST" });
      const outputDirectory = deps.readFlag(argv, "--out") || path.join(process.cwd(), "data", "reconstruction-context-packs");
      const artifacts = await writeContextPackArtifacts(contextPack, outputDirectory);
      console.log(`job: ${contextPack.jobId}`);
      console.log(`mode: ${contextPack.mode}`);
      console.log(`contextPack: ${artifacts.contextPath}`);
      console.log(`referencePreview: ${artifacts.referencePreviewPath}`);
      console.log(`referenceRectifiedPreview: ${artifacts.referenceRectifiedPreviewPath || "none"}`);
      console.log(`targetPreview: ${artifacts.targetPreviewPath || "none"}`);
      console.log("guidance:");
      for (const line of contextPack.guidance) {
        console.log(`- ${line}`);
      }
      console.log("workflow:");
      for (const line of contextPack.workflow) {
        console.log(`- ${line}`);
      }
      console.log("scoringRubric:");
      for (const line of contextPack.scoringRubric) {
        console.log(`- ${line}`);
      }
      return;
    }

    if (argv.includes("--submit-analysis")) {
      const analysisFile = deps.readFlag(argv, "--analysis-file");
      const analysisJson = deps.readFlag(argv, "--analysis-json");
      if (!analysisFile && !analysisJson) {
        fail("--submit-analysis 需要 --analysis-file 或 --analysis-json。");
      }
      if (analysisFile && analysisJson) {
        fail("--submit-analysis 只能使用一种输入方式：--analysis-file 或 --analysis-json。");
      }
      const payload = analysisFile
        ? await deps.readJsonFile<SubmitReconstructionAnalysisPayload>(analysisFile)
        : (JSON.parse(analysisJson as string) as SubmitReconstructionAnalysisPayload);
      const job = await deps.requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/submit-analysis`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      printReconstructionJob(job);
      return;
    }

    if (argv.includes("--preview-plan")) {
      const job = await deps.requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/preview-plan`, { method: "POST" });
      printReconstructionJob(job);
      return;
    }

    if (argv.includes("--review-font")) {
      const textCandidateId = deps.readFlag(argv, "--text-candidate");
      const fontFamily = deps.readFlag(argv, "--font");
      if (!textCandidateId || !fontFamily) {
        fail("--review-font 需要 --text-candidate 和 --font。");
      }
      const payload: ReviewReconstructionFontPayload = { textCandidateId, fontFamily };
      const job = await deps.requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/review/font`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      printReconstructionJob(job);
      return;
    }

    if (argv.includes("--review-asset")) {
      const assetId = deps.readFlag(argv, "--asset");
      const decision = deps.readFlag(argv, "--decision");
      if (!assetId || (decision !== "approved" && decision !== "rejected")) {
        fail("--review-asset 需要 --asset 和 --decision approved|rejected。");
      }
      const payload: ReviewReconstructionAssetPayload = { assetId, decision, note: deps.readFlag(argv, "--note") || undefined };
      const job = await deps.requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/review/asset`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      printReconstructionJob(job);
      return;
    }

    if (argv.includes("--approve-plan") || argv.includes("--request-changes")) {
      const payload: ApproveReconstructionPlanPayload = {
        approved: argv.includes("--approve-plan"),
        note: deps.readFlag(argv, "--note") || undefined,
      };
      const job = await deps.requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/review/approve-plan`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      printReconstructionJob(job);
      return;
    }

    for (const action of ["apply", "clear", "render", "measure", "refine", "iterate", "loop"] as const) {
      if (argv.includes(`--${action}`)) {
        if (action === "apply" || action === "measure" || action === "refine" || action === "iterate" || action === "loop") {
          const currentJob = await deps.requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}`);
          const blockedMessage = getBlockedExecutionActionMessage(currentJob, action);
          if (blockedMessage) {
            fail(blockedMessage);
          }
        }
        const job = await deps.requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/${action}`, {
          method: "POST",
        });
        printReconstructionJob(job);
        return;
      }
    }

    const job = await deps.requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}`);
    printReconstructionJob(job);
    return;
  }

  if (argv.includes("--list")) {
    const snapshot = await deps.requestJson<ReconstructionJobSnapshot>("/api/reconstruction/jobs");
    if (!snapshot.jobs.length) {
      console.log("当前没有 reconstruction job。");
      return;
    }

    for (const job of snapshot.jobs) {
      console.log(`${job.id} | ${job.status} | ${job.targetNode.name} <= ${job.referenceNode.name} | ${job.currentStageId}`);
    }
    return;
  }

  const snapshot = await deps.requestJson<PluginBridgeSnapshot>("/api/plugin-bridge");
  const session = deps.pickSession(snapshot.sessions, deps.readFlag(argv, "--session"));
  const maxIterationsRaw = deps.readFlag(argv, "--max-iterations");
  const payload: CreateReconstructionJobPayload = {
    targetSessionId: session.id,
    targetNodeId: deps.readFlag(argv, "--target") || undefined,
    referenceNodeId: deps.readFlag(argv, "--reference") || undefined,
    goal: "pixel-match",
    strategy: (() => {
      try {
        return parseReconstructionStrategy(argv, deps.readFlag);
      } catch (error) {
        fail(error instanceof Error ? error.message : "reconstruction strategy 解析失败。");
      }
    })(),
    maxIterations: maxIterationsRaw !== null ? Number.parseInt(maxIterationsRaw, 10) : undefined,
    allowOutpainting: argv.includes("--allow-outpainting"),
  };

  const job = await deps.requestJson<ReconstructionJob>("/api/reconstruction/jobs", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  printReconstructionJob(job);
  if (job.input.strategy === "raster-exact") {
    console.log("next: --apply -> --render -> --measure");
  } else if (job.input.strategy === "vector-reconstruction") {
    console.log("next: --analyze -> --context-pack -> --submit-analysis -> --apply -> --render -> --measure");
  } else if (job.input.strategy === "hybrid-reconstruction") {
    console.log("next: --analyze -> --context-pack -> --submit-analysis -> --preview-plan -> --approve-plan -> --apply -> --render -> --measure");
  } else {
    console.log("next: --analyze or --context-pack");
  }
}
