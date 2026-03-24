import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeFontWeightStyle,
  normalizeTextAlignment,
} from "./text-style-helpers.js";

(
  globalThis as any
).figma = {
  mixed: Symbol("mixed"),
};

test("normalizeFontWeightStyle maps numeric and localized weight labels", () => {
  assert.equal(normalizeFontWeightStyle(750), "Bold");
  assert.equal(normalizeFontWeightStyle(620), "Semi Bold");
  assert.equal(normalizeFontWeightStyle("粗体"), "Bold");
  assert.equal(normalizeFontWeightStyle("常规"), "Regular");
});

test("normalizeTextAlignment supports localized aliases and rejects unknown values", () => {
  assert.equal(normalizeTextAlignment("居中对齐"), "CENTER");
  assert.equal(normalizeTextAlignment("right"), "RIGHT");
  assert.throws(() => normalizeTextAlignment("diagonal"), /不支持的文本对齐值/);
});
