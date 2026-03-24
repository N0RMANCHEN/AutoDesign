import type {
  DesignIntent,
  DesignModePolicy,
  DesignTaskMode,
} from "../../shared/design-task.js";
import type { ReconstructionJob } from "../../shared/reconstruction.js";

export function inferDesignTaskModeFromReconstructionJob(
  job: Pick<ReconstructionJob, "input" | "analysis">,
): DesignTaskMode {
  if (job.input.strategy === "structural-preview") {
    return "generation";
  }
  if (job.input.allowOutpainting || (job.analysis?.completionZones.length ?? 0) > 0) {
    return "completion";
  }
  return "restoration";
}

export function buildDesignModePolicy(mode: DesignTaskMode): DesignModePolicy {
  return {
    mode,
    outputTarget: "figma-native",
    qualityPriority:
      mode === "generation"
        ? "design-quality"
        : mode === "completion"
          ? "style-consistency"
          : "pixel-fidelity",
    automationMode: "automatic-iterative",
    humanLoopMode: "auto",
    referencePolicy: mode === "generation" ? "preferred" : "required",
    editabilityRequired: true,
  };
}

export function buildDesignIntent(options: {
  mode: DesignTaskMode;
  warnings?: string[];
  notes?: string[];
}): DesignIntent {
  const policy = buildDesignModePolicy(options.mode);
  return {
    ...policy,
    notes: [...(options.notes ?? []), ...(options.warnings ?? [])],
  };
}

export function buildDesignIntentFromReconstructionJob(
  job: Pick<ReconstructionJob, "input" | "analysis" | "warnings">,
): DesignIntent {
  const mode = inferDesignTaskModeFromReconstructionJob(job);
  return buildDesignIntent({
    mode,
    warnings: job.warnings,
    notes: [
      "Compatibility view generated from reconstruction jobs while the generalized design-task core is rolled out.",
      "Region-level single-cluster iteration remains the default acceptance policy for automated refinements.",
    ],
  });
}
