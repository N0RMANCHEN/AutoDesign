import type {
  DesignScorecard,
  DesignTaskSnapshot,
} from "../../shared/design-task.js";
import type {
  ReconstructionElementScore,
  ReconstructionJob,
} from "../../shared/reconstruction.js";
import { buildDefaultIterationPolicy } from "./iteration-policy.js";
import {
  buildDesignIntentFromReconstructionJob,
  inferDesignTaskModeFromReconstructionJob,
} from "./mode-policy.js";
import {
  buildDesignScorecard,
  buildDesignElementScorecardsFromReconstructionScores,
  buildDesignScorecardFromReconstructionJob,
  gradeDesignCompositeScore,
} from "./scorecard.js";
import { buildDesignSceneFromReconstructionAnalysis } from "./scene-graph.js";

export function buildDesignScorecardFromReconstructionElementScores(
  job: ReconstructionJob,
  elementScores: ReconstructionElementScore[],
): DesignScorecard {
  return buildDesignScorecardFromReconstructionJob(
    job,
    inferDesignTaskModeFromReconstructionJob(job),
    elementScores,
  );
}

export function buildDesignTaskSnapshotFromReconstructionJob(
  job: ReconstructionJob,
): DesignTaskSnapshot {
  if (!job.analysis) {
    throw new Error("Reconstruction job has no structured analysis yet.");
  }

  const mode = inferDesignTaskModeFromReconstructionJob(job);
  const scene = buildDesignSceneFromReconstructionAnalysis({
    jobId: job.id,
    mode,
    analysis: job.analysis,
  });

  const scorecard =
    job.diffMetrics || Number.isFinite(job.diffScore)
      ? buildDesignScorecard({
          mode,
          compositeScore: job.diffMetrics?.compositeScore ?? job.diffScore ?? 0,
          hardFailures:
            job.diffMetrics?.acceptanceGates
              .filter((gate) => gate.hard && !gate.passed)
              .map((gate) => gate.id) || [],
          notes: job.warnings,
          grade:
            job.diffMetrics?.grade ||
            gradeDesignCompositeScore(job.diffMetrics?.compositeScore ?? job.diffScore ?? 0),
        })
      : null;

  return {
    taskId: `design-task/${job.id}`,
    sourceTask: {
      kind: "reconstruction-job",
      sourceId: job.id,
      strategy: job.input.strategy,
    },
    mode,
    intent: buildDesignIntentFromReconstructionJob(job),
    scene,
    scorecard,
  };
}
