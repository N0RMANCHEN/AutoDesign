import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectNodeSubtree,
  nodeSummary,
} from "./selection-context.js";

test("nodeSummary captures style ids and bound variable bindings", () => {
  (globalThis as any).figma = {
    mixed: Symbol("mixed"),
  };

  const node = {
    id: "1:1",
    name: "Card",
    type: "FRAME",
    x: 10,
    y: 20,
    width: 160,
    height: 100,
    layoutMode: "VERTICAL",
    layoutPositioning: "AUTO",
    fillStyleId: "S:fill-card",
    strokeStyleId: "S:stroke-card",
    effectStyleId: "S:effect-card",
    gridStyleId: "S:grid-card",
    fills: [{ type: "SOLID", color: { r: 1, g: 0.5, b: 0 } }],
    strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
    boundVariables: {
      fills: [{ id: "var-fill-card" }],
      itemSpacing: { id: "var-gap-card" },
      paddingLeft: { id: "var-pad-card" },
    },
    parent: {
      id: "0:1",
      type: "PAGE",
      layoutMode: "NONE",
    },
  };

  const summary = nodeSummary(node);

  assert.equal(summary.fillStyleId, "S:fill-card");
  assert.equal(summary.styleBindings?.strokeStyleId, "S:stroke-card");
  assert.equal(summary.styleBindings?.effectStyleId, "S:effect-card");
  assert.equal(summary.styleBindings?.gridStyleId, "S:grid-card");
  assert.deepEqual(summary.boundVariableIds, ["var-fill-card", "var-gap-card", "var-pad-card"]);
  assert.deepEqual(summary.variableBindings?.fills, ["var-fill-card"]);
  assert.deepEqual(summary.variableBindings?.itemSpacing, ["var-gap-card"]);
});

test("inspectNodeSubtree preserves nested text style and variable bindings", () => {
  (globalThis as any).figma = {
    mixed: Symbol("mixed"),
  };

  const child = {
    id: "1:2",
    name: "Title",
    type: "TEXT",
    x: 12,
    y: 16,
    width: 120,
    height: 32,
    textStyleId: "S:text-title",
    fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
    boundVariables: {
      fills: [{ id: "var-text-fill" }],
      fontSize: { id: "var-font-size" },
    },
    characters: "Hello",
    fontName: { family: "Inter", style: "Bold" },
    fontSize: 24,
    lineHeight: { value: 32, unit: "PIXELS" },
    letterSpacing: { value: 0.2, unit: "PIXELS" },
    textAlignHorizontal: "CENTER",
    textAutoResize: "HEIGHT",
    parent: null as any,
  };
  const root = {
    id: "1:1",
    name: "Card",
    type: "FRAME",
    x: 10,
    y: 20,
    width: 160,
    height: 100,
    layoutWrap: "WRAP",
    counterAxisSpacing: 18,
    minWidth: 120,
    fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
    fillStyleId: "S:fill-card",
    strokes: [],
    children: [child],
    parent: {
      id: "0:1",
      type: "PAGE",
      children: [],
    },
  };
  child.parent = root;

  const subtree = inspectNodeSubtree(root);

  assert.equal(subtree.length, 2);
  assert.equal(subtree[1]?.id, "1:2");
  assert.equal(subtree[1]?.styleBindings?.textStyleId, "S:text-title");
  assert.deepEqual(subtree[1]?.boundVariableIds, ["var-font-size", "var-text-fill"]);
  assert.deepEqual(subtree[1]?.variableBindings?.fontSize, ["var-font-size"]);
  assert.deepEqual(subtree[1]?.variableBindings?.fills, ["var-text-fill"]);
  assert.equal(subtree[1]?.textAutoResize, "HEIGHT");
  assert.equal(subtree[0]?.layoutWrap, "WRAP");
  assert.equal(subtree[0]?.counterAxisSpacing, 18);
  assert.equal(subtree[0]?.minWidth, 120);
});
