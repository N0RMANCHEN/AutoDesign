import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRuntimeVariableDefsSnapshot,
  buildUnavailableRuntimeVariableDefsSnapshot,
} from "./runtime-variable-defs.js";

test("buildUnavailableRuntimeVariableDefsSnapshot keeps the explicit gap marker", () => {
  const snapshot = buildUnavailableRuntimeVariableDefsSnapshot("variables unavailable");

  assert.equal(snapshot.available, false);
  assert.equal(snapshot.source, null);
  assert.equal(snapshot.note, "variables unavailable");
  assert.deepEqual(snapshot.variables, []);
});

test("buildRuntimeVariableDefsSnapshot exposes live session variables and summary buckets", () => {
  const snapshot = buildRuntimeVariableDefsSnapshot({
    pluginSession: {
      hasVariableSnapshot: true,
      variableCollections: [
        {
          id: "collection-colors",
          name: "Colors",
          defaultModeId: "mode-light",
          hiddenFromPublishing: false,
          modes: [
            { modeId: "mode-light", name: "Light" },
            { modeId: "mode-dark", name: "Dark" },
          ],
        },
        {
          id: "collection-layout",
          name: "Layout",
          defaultModeId: "mode-base",
          hiddenFromPublishing: false,
          modes: [{ modeId: "mode-base", name: "Base" }],
        },
      ],
      variables: [
        {
          id: "var-color-primary",
          name: "primary",
          collectionId: "collection-colors",
          collectionName: "Colors",
          resolvedType: "COLOR",
          hiddenFromPublishing: false,
          scopes: ["ALL_FILLS"],
          valuesByMode: [
            { modeId: "mode-light", modeName: "Light", kind: "color", value: "#0F172A" },
            { modeId: "mode-dark", modeName: "Dark", kind: "color", value: "#E2E8F0" },
          ],
        },
        {
          id: "var-spacing-md",
          name: "spacing/md",
          collectionId: "collection-layout",
          collectionName: "Layout",
          resolvedType: "FLOAT",
          hiddenFromPublishing: false,
          scopes: ["GAP"],
          valuesByMode: [
            { modeId: "mode-base", modeName: "Base", kind: "number", value: 16 },
          ],
        },
        {
          id: "var-font-size-body",
          name: "font/body",
          collectionId: "collection-layout",
          collectionName: "Layout",
          resolvedType: "FLOAT",
          hiddenFromPublishing: false,
          scopes: ["FONT_SIZE"],
          valuesByMode: [
            { modeId: "mode-base", modeName: "Base", kind: "number", value: 14 },
          ],
        },
      ],
    },
  });

  assert.equal(snapshot.available, true);
  assert.equal(snapshot.source, "plugin-session-variable-snapshot");
  assert.match(snapshot.note, /plugin live session/);
  assert.deepEqual(snapshot.colors, ["Colors/primary = #0F172A"]);
  assert.deepEqual(snapshot.spacing, ["Layout/spacing/md = 16"]);
  assert.deepEqual(snapshot.typography, ["Layout/font/body = 14"]);
  assert.equal(snapshot.variables.length, 3);
});
