import assert from "node:assert/strict";
import test from "node:test";

import {
  applyFillStrokeOpacity,
  applyStrokeWeightToNode,
  createShadowEffect,
} from "./node-style-helpers.js";

(
  globalThis as any
).figma = {
  mixed: Symbol("mixed"),
};

test("applyStrokeWeightToNode returns a warning when the node has no strokes", () => {
  const node = {
    id: "shape-1",
    name: "Shape",
    type: "RECTANGLE",
    strokes: [],
    strokeWeight: 0,
  };

  const result = applyStrokeWeightToNode(node, 2);

  assert.equal(result.changed, false);
  assert.match(result.warning || "", /当前没有 stroke/);
});

test("applyFillStrokeOpacity validates numeric ranges before mutating the node", () => {
  const node = {
    type: "RECTANGLE",
    fills: [],
    strokes: [],
    strokeWeight: 0,
    opacity: 1,
  };

  assert.throws(() => applyFillStrokeOpacity(node, { opacity: 2 }), /opacity 必须是 0 到 1 之间的数字/);
  assert.throws(() => applyFillStrokeOpacity(node, { strokeWeight: -1 }), /strokeWeight 必须是大于等于 0 的数字/);
});

test("createShadowEffect clamps opacity into the expected 0..1 range", () => {
  const effect = createShadowEffect({
    offsetX: 8,
    offsetY: 12,
    blur: 24,
    opacity: 150,
    colorHex: "#123456",
  });

  assert.equal(effect.type, "DROP_SHADOW");
  assert.equal(effect.color.a, 1);
  assert.equal(effect.offset.x, 8);
  assert.equal(effect.offset.y, 12);
});
