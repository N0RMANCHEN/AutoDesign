import assert from "node:assert/strict";
import test from "node:test";

import { buildContextPack } from "./context-pack.js";
import type { ProjectData } from "./types.js";

function createProject(): ProjectData {
  return {
    meta: {
      id: "project-1",
      name: "AutoDesign",
      description: "test project",
      updatedAt: "2026-03-23T00:00:00.000Z",
    },
    designSources: [
      {
        id: "source-1",
        name: "Marketing Site",
        figmaFileKey: "figma-key",
        branch: "main",
        status: "connected",
        lastSyncedAt: "2026-03-23T00:00:00.000Z",
        summary: "Landing page source",
      },
    ],
    designScreens: [
      {
        id: "screen-1",
        sourceId: "source-1",
        name: "Hero",
        purpose: "marketing hero",
        stateNotes: ["default", "scrolled"],
        summary: "Top of funnel hero screen",
      },
    ],
    componentMappings: [
      {
        id: "mapping-1",
        designName: "Hero Card",
        reactName: "HeroCard",
        status: "prototype",
        props: ["title", "ctaLabel"],
        states: ["default", "loading"],
        notes: "Maps hero card UI",
        screenIds: ["screen-1"],
      },
    ],
    reviewItems: [
      {
        id: "review-1",
        title: "Check CTA spacing",
        area: "hero",
        status: "doing",
        owner: "hirohi",
        detail: "CTA spacing differs from Figma by 4px",
        relatedIds: ["screen-1", "mapping-1"],
      },
    ],
    libraryAssets: [],
    runtimeSessions: [],
  };
}

test("buildContextPack preserves selection order across source, screen, mapping and review buckets", () => {
  const pack = buildContextPack({
    project: createProject(),
    selectionIds: ["mapping-1", "source-1", "review-1", "screen-1"],
    graphKind: "codegraph",
    action: "codegraph/summarize",
  });

  assert.equal(pack.primaryId, "source-1");
  assert.deepEqual(
    pack.nodes.map((node) => node.id),
    ["source-1", "screen-1", "mapping-1", "review-1"],
  );
  assert.equal(pack.constraints.maxNewNodes, 4);
  assert.equal(pack.constraints.allowDelete, false);
  assert.equal(pack.constraints.allowEdges, true);
});

test("buildContextPack switches node budget for knowledge graph actions", () => {
  const pack = buildContextPack({
    project: createProject(),
    selectionIds: ["review-1"],
    graphKind: "knowledge",
    action: "knowledge/learning_path",
  });

  assert.equal(pack.primaryId, "review-1");
  assert.equal(pack.constraints.maxNewNodes, 6);
  assert.match(pack.nodes[0]?.summary ?? "", /owner=hirohi/);
});

test("buildContextPack returns an empty pack when no selected ids exist in the project", () => {
  const pack = buildContextPack({
    project: createProject(),
    selectionIds: ["missing-id"],
    graphKind: "codegraph",
    action: "codegraph/branch",
  });

  assert.equal(pack.primaryId, null);
  assert.deepEqual(pack.nodes, []);
});
