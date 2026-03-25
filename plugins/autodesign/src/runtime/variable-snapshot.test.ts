import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeVariableCollections,
  normalizeVariables,
} from "./variable-snapshot.js";

test("normalizeVariableCollections keeps modes and default mode metadata stable", () => {
  const collections = normalizeVariableCollections([
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
  ]);

  assert.deepEqual(collections, [
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
  ]);
});

test("normalizeVariables captures typed values, aliases and collection names", () => {
  const collections = normalizeVariableCollections([
    {
      id: "collection-colors",
      name: "Colors",
      defaultModeId: "mode-light",
      modes: [
        { modeId: "mode-light", name: "Light" },
        { modeId: "mode-dark", name: "Dark" },
      ],
    },
    {
      id: "collection-layout",
      name: "Layout",
      defaultModeId: "mode-base",
      modes: [{ modeId: "mode-base", name: "Base" }],
    },
  ]);

  const variables = normalizeVariables({
    collections,
    variables: [
      {
        id: "var-color-primary",
        name: "primary",
        variableCollectionId: "collection-colors",
        resolvedType: "COLOR",
        scopes: ["ALL_FILLS"],
        valuesByMode: {
          "mode-light": { r: 1, g: 0.5, b: 0, a: 1 },
          "mode-dark": { type: "VARIABLE_ALIAS", id: "var-color-primary-dark" },
        },
      },
      {
        id: "var-spacing-md",
        name: "spacing/md",
        variableCollectionId: "collection-layout",
        resolvedType: "FLOAT",
        scopes: ["GAP"],
        valuesByMode: {
          "mode-base": 16,
        },
      },
    ],
  });

  assert.equal(variables.length, 2);
  assert.equal(variables[0]?.collectionName, "Colors");
  assert.equal(variables[0]?.valuesByMode[0]?.value, "#FF8000");
  assert.equal(variables[0]?.valuesByMode[0]?.modeName, "Light");
  assert.equal(variables[0]?.valuesByMode[1]?.kind, "alias");
  assert.equal(variables[0]?.valuesByMode[1]?.value, "alias:var-color-primary-dark");
  assert.equal(variables[1]?.resolvedType, "FLOAT");
  assert.equal(variables[1]?.valuesByMode[0]?.value, 16);
});
