import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRuntimeDesignContext,
  buildRuntimeMetadataSnapshot,
  buildRuntimePluginSelectionSnapshot,
  buildRuntimeVariableDefsContext,
} from "./runtime-design-context.js";
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
    runtimeSessions: [],
  };
}

test("buildRuntimeDesignContext expands related screens, mappings and reviews around the selected mapping", () => {
  const context = buildRuntimeDesignContext({
    project: createProject(),
    selectionIds: ["mapping-1"],
    graphKind: "codegraph",
    action: "codegraph/summarize",
  });

  assert.deepEqual(context.selectionIds, ["mapping-1"]);
  assert.equal(context.primarySelectionId, "mapping-1");
  assert.deepEqual(
    context.designContext.sources.map((item) => item.id),
    ["source-1"],
  );
  assert.deepEqual(
    context.designContext.screens.map((item) => item.id),
    ["screen-1"],
  );
  assert.deepEqual(
    context.designContext.componentMappings.map((item) => item.id),
    ["mapping-1"],
  );
  assert.deepEqual(
    context.designContext.reviewItems.map((item) => item.id),
    ["review-1"],
  );
  assert.deepEqual(
    context.metadata.map((item) => item.kind),
    ["designSource", "screen", "component", "review"],
  );
  assert.equal(context.contextPack.primaryId, "mapping-1");
  assert.equal(context.pluginSelection.available, false);
  assert.equal(context.pluginSelection.source, null);
});

test("buildRuntimeDesignContext returns an explicit unavailable note for variable defs", () => {
  const context = buildRuntimeDesignContext({
    project: createProject(),
    selectionIds: ["screen-1"],
    graphKind: "knowledge",
    action: "knowledge/branch",
  });

  assert.equal(context.variableDefs.available, false);
  assert.equal(context.variableDefs.source, null);
  assert.match(context.variableDefs.note, /还没有真实的 variables\/styles truth/);
  assert.deepEqual(context.variableDefs.colors, []);
  assert.deepEqual(context.variableDefs.variables, []);
  assert.equal(context.contextPack.graphKind, "knowledge");
  assert.match(
    String(context.pluginSelection.note),
    /没有绑定 plugin session/,
  );
});

test("buildRuntimeMetadataSnapshot returns related metadata around the selected mapping", () => {
  const snapshot = buildRuntimeMetadataSnapshot({
    project: createProject(),
    selectionIds: ["mapping-1"],
  });

  assert.equal(snapshot.primarySelectionId, "mapping-1");
  assert.deepEqual(
    snapshot.metadata.map((item) => item.id),
    ["source-1", "screen-1", "mapping-1", "review-1"],
  );
});

test("buildRuntimeVariableDefsContext returns an explicit gap marker until workspace stores live token truth", () => {
  const snapshot = buildRuntimeVariableDefsContext({
    project: createProject(),
    selectionIds: ["screen-1"],
  });

  assert.equal(snapshot.primarySelectionId, "screen-1");
  assert.equal(snapshot.variableDefs.available, false);
  assert.equal(snapshot.variableDefs.source, null);
  assert.match(snapshot.variableDefs.note, /workspace project model 还没有真实的 variables\/styles truth/);
});

test("buildRuntimeVariableDefsContext surfaces live plugin variable snapshots when provided", () => {
  const snapshot = buildRuntimeVariableDefsContext({
    project: createProject(),
    selectionIds: ["screen-1"],
    pluginSession: {
      hasVariableSnapshot: true,
      variableCollections: [
        {
          id: "collection-colors",
          name: "Colors",
          defaultModeId: "mode-light",
          hiddenFromPublishing: false,
          modes: [{ modeId: "mode-light", name: "Light" }],
        },
      ],
      variables: [
        {
          id: "var-primary",
          name: "primary",
          collectionId: "collection-colors",
          collectionName: "Colors",
          resolvedType: "COLOR",
          hiddenFromPublishing: false,
          scopes: ["ALL_FILLS"],
          valuesByMode: [
            { modeId: "mode-light", modeName: "Light", kind: "color", value: "#112233" },
          ],
        },
      ],
    },
  });

  assert.equal(snapshot.variableDefs.available, true);
  assert.equal(snapshot.variableDefs.source, "plugin-session-variable-snapshot");
  assert.deepEqual(snapshot.variableDefs.colors, ["Colors/primary = #112233"]);
  assert.equal(snapshot.variableDefs.variables.length, 1);
});

test("buildRuntimePluginSelectionSnapshot surfaces cached plugin selection dependency truth", () => {
  const snapshot = buildRuntimePluginSelectionSnapshot({
    pluginSession: {
      id: "session-1",
      selection: [
        {
          id: "node-1",
          name: "Card",
          type: "FRAME",
          fillable: true,
          fills: [],
          fillStyleId: "S:fill-card",
          styleBindings: {
            fillStyleId: "S:fill-card",
            strokeStyleId: null,
            textStyleId: null,
            effectStyleId: "S:effect-card",
            gridStyleId: null,
          },
          boundVariableIds: ["var-fill-card"],
          variableBindings: {
            fills: ["var-fill-card"],
          },
        },
        {
          id: "node-2",
          name: "Title",
          type: "TEXT",
          fillable: true,
          fills: [],
          fillStyleId: null,
          styleBindings: {
            fillStyleId: null,
            strokeStyleId: null,
            textStyleId: "S:text-title",
            effectStyleId: null,
            gridStyleId: null,
          },
          boundVariableIds: ["var-text-color"],
          variableBindings: {
            fills: ["var-text-color"],
          },
        },
      ],
      hasStyleSnapshot: true,
      styles: [
        {
          id: "S:fill-card",
          styleType: "paint",
          name: "Fill/Card",
          description: null,
        },
        {
          id: "S:effect-card",
          styleType: "effect",
          name: "Shadow/Card",
          description: null,
        },
      ],
      hasVariableSnapshot: true,
      variableCollections: [],
      variables: [
        {
          id: "var-fill-card",
          name: "card/fill",
          collectionId: "collection-colors",
          collectionName: "Colors",
          resolvedType: "COLOR",
          hiddenFromPublishing: false,
          scopes: ["ALL_FILLS"],
          valuesByMode: [],
        },
      ],
    },
  });

  assert.equal(snapshot.available, true);
  assert.equal(snapshot.source, "plugin-selection-summary");
  assert.equal(snapshot.primarySelectionNodeId, "node-1");
  assert.deepEqual(snapshot.selectionNodeIds, ["node-1", "node-2"]);
  assert.deepEqual(snapshot.dependencies.resolvedStyles.map((item) => item.id), [
    "S:fill-card",
    "S:effect-card",
  ]);
  assert.deepEqual(snapshot.dependencies.resolvedVariables.map((item) => item.id), [
    "var-fill-card",
  ]);
  assert.deepEqual(snapshot.dependencies.unresolvedStyleIds, ["S:text-title"]);
  assert.deepEqual(snapshot.dependencies.unresolvedVariableIds, ["var-text-color"]);
});

test("buildRuntimeDesignContext surfaces plugin selection dependency truth when a session is targeted", () => {
  const context = buildRuntimeDesignContext({
    project: createProject(),
    selectionIds: ["mapping-1"],
    graphKind: "codegraph",
    action: "codegraph/summarize",
    pluginSession: {
      id: "session-1",
      selection: [
        {
          id: "node-1",
          name: "Card",
          type: "FRAME",
          fillable: true,
          fills: [],
          fillStyleId: "S:fill-card",
          styleBindings: {
            fillStyleId: "S:fill-card",
            strokeStyleId: null,
            textStyleId: null,
            effectStyleId: null,
            gridStyleId: null,
          },
          boundVariableIds: ["var-primary"],
          variableBindings: {
            fills: ["var-primary"],
          },
        },
      ],
      hasStyleSnapshot: true,
      styles: [
        {
          id: "S:fill-card",
          styleType: "paint",
          name: "Fill/Card",
          description: null,
        },
      ],
      hasVariableSnapshot: true,
      variableCollections: [
        {
          id: "collection-colors",
          name: "Colors",
          defaultModeId: "mode-light",
          hiddenFromPublishing: false,
          modes: [{ modeId: "mode-light", name: "Light" }],
        },
      ],
      variables: [
        {
          id: "var-primary",
          name: "primary",
          collectionId: "collection-colors",
          collectionName: "Colors",
          resolvedType: "COLOR",
          hiddenFromPublishing: false,
          scopes: ["ALL_FILLS"],
          valuesByMode: [
            { modeId: "mode-light", modeName: "Light", kind: "color", value: "#112233" },
          ],
        },
      ],
    },
  });

  assert.equal(context.pluginSelection.available, true);
  assert.deepEqual(context.pluginSelection.selectionNodeIds, ["node-1"]);
  assert.deepEqual(context.pluginSelection.dependencies.resolvedStyles.map((item) => item.id), [
    "S:fill-card",
  ]);
  assert.deepEqual(context.pluginSelection.dependencies.resolvedVariables.map((item) => item.id), [
    "var-primary",
  ]);
  assert.deepEqual(context.pluginSelection.dependencies.unresolvedStyleIds, []);
  assert.deepEqual(context.pluginSelection.dependencies.unresolvedVariableIds, []);
});
