import assert from "node:assert/strict";
import test from "node:test";

import { runPluginCommandBatch } from "./capability-runner.js";

function createContainerNode(id: string, type: string, name: string) {
  const node = {
    id,
    type,
    name,
    children: [] as any[],
    parent: null as any,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    layoutMode: "NONE",
    clipsContent: false,
    fills: [] as any[],
    appendChild(child: any) {
      child.parent = node;
      node.children.push(child);
      return child;
    },
    resize(width: number, height: number) {
      node.width = width;
      node.height = height;
    },
    setSharedPluginData() {},
  };
  return node;
}

test("runPluginCommandBatch resolves analysis-ref nodeIds without requiring a manual selection", async () => {
  const nodes = new Map<string, any>();
  const currentPage = createContainerNode("0:1", "PAGE", "Page 1") as any;
  currentPage.selection = [];
  const root = {
    name: "Test File",
  };

  let nextId = 1;
  (globalThis as any).figma = {
    mixed: Symbol("mixed"),
    root,
    currentPage,
    createFrame() {
      const frame = createContainerNode(`9:${nextId++}`, "FRAME", "Frame");
      nodes.set(frame.id, frame);
      return frame;
    },
    async getNodeByIdAsync(id: string) {
      if (id === currentPage.id) {
        return currentPage;
      }
      return nodes.get(id) || null;
    },
  };

  const result = await runPluginCommandBatch({
    source: "codex",
    commands: [
      {
        type: "capability",
        capabilityId: "nodes.create-frame",
        payload: {
          name: "Root Frame",
          width: 320,
          height: 180,
          parentNodeId: "0:1",
          analysisRefId: "analysis:root-frame",
        },
      },
      {
        type: "capability",
        capabilityId: "nodes.set-clips-content",
        payload: {
          value: true,
        },
        nodeIds: ["analysis:root-frame"],
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.results[0]?.ok, true);
  assert.equal(result.results[1]?.ok, true);
  assert.equal(nodes.size, 1);
  assert.equal([...nodes.values()][0]?.clipsContent, true);
});

test("runPluginCommandBatch allows runtime font catalog inspection without nodeIds", async () => {
  const currentPage = createContainerNode("0:1", "PAGE", "Page 1") as any;
  currentPage.selection = [];
  const root = {
    name: "Test File",
  };

  (globalThis as any).figma = {
    mixed: Symbol("mixed"),
    root,
    currentPage,
    async listAvailableFontsAsync() {
      return [
        { fontName: { family: "Didot", style: "Regular" } },
        { fontName: { family: "Didot", style: "Semibold" } },
      ];
    },
  };

  const result = await runPluginCommandBatch({
    source: "codex",
    commands: [
      {
        type: "capability",
        capabilityId: "runtime.inspect-font-catalog",
        payload: {},
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.results[0]?.ok, true);
  assert.deepEqual(result.results[0]?.fontCatalog, [
    {
      family: "Didot",
      style: "Regular",
      familyKey: "didot",
      styleKey: "regular",
    },
    {
      family: "Didot",
      style: "Semibold",
      familyKey: "didot",
      styleKey: "semibold",
    },
  ]);
});

test("runPluginCommandBatch probes exact font loads without requiring nodeIds", async () => {
  const currentPage = createContainerNode("0:1", "PAGE", "Page 1") as any;
  currentPage.selection = [];

  const attempted: Array<{ family: string; style: string }> = [];
  (globalThis as any).figma = {
    mixed: Symbol("mixed"),
    root: { name: "Test File" },
    currentPage,
    async loadFontAsync(font: { family: string; style: string }) {
      attempted.push(font);
      if (font.family === "Didot" && font.style === "Bold") {
        return;
      }
      throw new Error("missing");
    },
  };

  const result = await runPluginCommandBatch({
    source: "codex",
    commands: [
      {
        type: "capability",
        capabilityId: "runtime.probe-font-load",
        payload: {
          fonts: [
            { family: "Didot", style: "Bold" },
            { family: "Iowan Old Style", style: "Roman" },
          ],
        },
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.results[0]?.ok, true);
  assert.deepEqual(attempted, [
    { family: "Didot", style: "Bold" },
    { family: "Iowan Old Style", style: "Roman" },
  ]);
  assert.deepEqual(result.results[0]?.fontLoadResults, [
    {
      family: "Didot",
      style: "Bold",
      familyKey: "didot",
      styleKey: "bold",
      ok: true,
      message: "font load succeeded",
    },
    {
      family: "Iowan Old Style",
      style: "Roman",
      familyKey: "iowanoldstyle",
      styleKey: "roman",
      ok: false,
      message: "missing",
    },
  ]);
});
