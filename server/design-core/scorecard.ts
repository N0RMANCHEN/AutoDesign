import type {
  DesignElementScorecard,
  DesignScoreGrade,
  DesignScorecard,
  DesignTaskMode,
} from "../../shared/design-task.js";
import type {
  ReconstructionElementScore,
  ReconstructionJob,
} from "../../shared/reconstruction.js";
import { buildDefaultIterationPolicy } from "./iteration-policy.js";
import { designRoleForReconstructionElementKind } from "./scene-graph.js";

export function gradeDesignCompositeScore(score: number): DesignScoreGrade {
  if (score >= 0.93) return "A";
  if (score >= 0.87) return "B";
  if (score >= 0.78) return "C";
  if (score >= 0.68) return "D";
  return "F";
}

export function buildDesignElementScorecardsFromReconstructionScores(
  elementScores: ReconstructionElementScore[],
): DesignElementScorecard[] {
  return elementScores.map((score) => ({
    elementId: score.elementId,
    elementName: score.elementName,
    role: designRoleForReconstructionElementKind(score.kind),
    compositeScore: score.compositeScore,
    geometryScore: score.geometryScore,
    styleScore: score.styleScore,
    typographyScore: score.typographyScore,
    alignmentScore: score.alignmentScore,
    editabilityScore: score.editabilityScore,
    hardFailures: score.hardFailures,
    notes: score.notes,
  }));
}

export function buildDesignScorecard(options: {
  mode: DesignTaskMode;
  compositeScore: number;
  elementScores?: ReconstructionElementScore[];
  hardFailures?: string[];
  notes?: string[];
  grade?: DesignScoreGrade;
}): DesignScorecard {
  const elements = buildDesignElementScorecardsFromReconstructionScores(options.elementScores ?? []);
  const hardFailures = options.hardFailures ?? Array.from(new Set(elements.flatMap((score) => score.hardFailures)));

  return {
    mode: options.mode,
    compositeScore: Number(options.compositeScore.toFixed(4)),
    grade: options.grade ?? gradeDesignCompositeScore(options.compositeScore),
    elementCount: elements.length,
    hardFailures,
    notes: options.notes ?? [],
    iterationPolicy: buildDefaultIterationPolicy(options.mode),
    elements,
  };
}

export function buildDesignScorecardFromReconstructionJob(
  job: Pick<ReconstructionJob, "diffMetrics" | "diffScore" | "warnings">,
  mode: DesignTaskMode,
  elementScores: ReconstructionElementScore[],
): DesignScorecard {
  const compositeScore = elementScores.length
    ? elementScores.reduce((sum, score) => sum + score.compositeScore, 0) / elementScores.length
    : job.diffMetrics?.compositeScore ?? job.diffScore ?? 0;

  return buildDesignScorecard({
    mode,
    compositeScore,
    elementScores,
    hardFailures:
      job.diffMetrics?.acceptanceGates
        .filter((gate) => gate.hard && !gate.passed)
        .map((gate) => gate.id) ?? [],
    notes: job.warnings,
    grade: job.diffMetrics?.grade ?? undefined,
  });
}
