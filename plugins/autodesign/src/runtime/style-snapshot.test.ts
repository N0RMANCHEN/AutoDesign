import assert from "node:assert/strict";
import test from "node:test";

import { normalizeStyleSnapshot } from "./style-snapshot.js";

test("normalizeStyleSnapshot collects local style definitions across style types", () => {
  const snapshot = normalizeStyleSnapshot({
    paintStyles: [
      { id: "S:paint-primary", name: "Brand/Primary", description: "main brand fill" },
    ],
    textStyles: [
      { id: "S:text-title", name: "Typography/Title", description: "" },
    ],
    effectStyles: [
      { id: "S:effect-card", name: "Shadow/Card" },
    ],
    gridStyles: [
      { id: "S:grid-layout", name: "Grid/Layout" },
    ],
  });

  assert.equal(snapshot.hasStyleSnapshot, true);
  assert.deepEqual(snapshot.styles, [
    {
      id: "S:paint-primary",
      styleType: "paint",
      name: "Brand/Primary",
      description: "main brand fill",
    },
    {
      id: "S:grid-layout",
      styleType: "grid",
      name: "Grid/Layout",
      description: null,
    },
    {
      id: "S:effect-card",
      styleType: "effect",
      name: "Shadow/Card",
      description: null,
    },
    {
      id: "S:text-title",
      styleType: "text",
      name: "Typography/Title",
      description: null,
    },
  ]);
});
