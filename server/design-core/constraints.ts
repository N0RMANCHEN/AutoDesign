import type { DesignConstraint } from "../../shared/design-task.js";
import type { ReconstructionElementConstraint } from "../../shared/reconstruction.js";

export function buildDesignConstraintsFromReconstructionConstraints(
  constraints: ReconstructionElementConstraint[],
): DesignConstraint[] {
  return constraints.map((constraint) => ({
    id: constraint.id,
    kind: constraint.kind,
    elementIds: [...constraint.elementIds],
    axis: constraint.axis,
    targetValue: constraint.targetValue,
    tolerance: constraint.tolerance,
    hard: constraint.hard,
    description: constraint.description,
  }));
}
