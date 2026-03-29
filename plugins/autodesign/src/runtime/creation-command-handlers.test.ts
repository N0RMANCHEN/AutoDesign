import assert from "node:assert/strict";
import test from "node:test";

import {
  hasExplicitCreationParent,
  tryRunCreationCapabilityCommand,
  resolveFontFamilyCandidates,
  resolveFontStyleCandidates,
  resolveImagePaintScaleMode,
  resolveTextBoxMode,
} from "./creation-command-handlers.js";
import { computeRasterPlacement } from "./asset-reconstruction-command-handlers.js";

test("hasExplicitCreationParent only accepts creation capabilities with parentNodeId", () => {
  assert.equal(
    hasExplicitCreationParent({
      type: "capability",
      capabilityId: "nodes.create-frame",
      payload: { parentNodeId: "12:3" },
    } as any),
    true,
  );
  assert.equal(
    hasExplicitCreationParent({
      type: "capability",
      capabilityId: "fills.set-fill",
      payload: { parentNodeId: "12:3" },
    } as any),
    false,
  );
});

test("computeRasterPlacement preserves target bounds for stretch and centers contain mode", () => {
  const stretch = computeRasterPlacement(200, 100, 20, 20, "stretch");
  const contain = computeRasterPlacement(200, 100, 100, 100, "contain");

  assert.deepEqual(stretch, {
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    scaleMode: "FILL",
  });
  assert.equal(contain.width, 100);
  assert.equal(contain.height, 100);
  assert.equal(contain.x, 50);
  assert.equal(contain.y, 0);
});

test("resolveTextBoxMode derives fixed or auto-height text boxes from width and height", () => {
  assert.equal(resolveTextBoxMode({}), null);
  assert.equal(resolveTextBoxMode({ width: 320 }), "HEIGHT");
  assert.equal(resolveTextBoxMode({ width: 320, height: 64 }), "NONE");
  assert.equal(resolveTextBoxMode({ width: 320, textAutoResize: "WIDTH_AND_HEIGHT" }), "WIDTH_AND_HEIGHT");
});

test("resolveImagePaintScaleMode maps contain to FIT and defaults others to FILL", () => {
  assert.equal(resolveImagePaintScaleMode("contain"), "FIT");
  assert.equal(resolveImagePaintScaleMode("cover"), "FILL");
  assert.equal(resolveImagePaintScaleMode("stretch"), "FILL");
});

test("resolveFontFamilyCandidates keeps explicit CSS stack families and skips generic names", () => {
  assert.deepEqual(
    resolveFontFamilyCandidates("Iowan Old Style", ["Iowan Old Style", "Times New Roman", "serif"]),
    ["Iowan Old Style", "Times New Roman"],
  );
});

test("resolveFontStyleCandidates expands 600 weight to semibold and bold aliases", () => {
  assert.deepEqual(resolveFontStyleCandidates(undefined, 600).slice(0, 4), [
    "Semibold",
    "Semi Bold",
    "Bold",
    "Regular",
  ]);
});

test("nodes.create-text loads the browser-resolved font even when it is absent from the visible font catalog", async () => {
  const currentPage = {
    id: "0:1",
    type: "PAGE",
    name: "Page 1",
    children: [] as any[],
    appendChild(child: any) {
      child.parent = currentPage;
      currentPage.children.push(child);
      return child;
    },
  };

  let nextTextId = 1;
  const attemptedFonts: Array<{ family: string; style: string }> = [];
  (globalThis as any).figma = {
    mixed: Symbol("mixed"),
    currentPage,
    async getNodeByIdAsync(id: string) {
      return id === "0:1" ? currentPage : null;
    },
    async listAvailableFontsAsync() {
      return [
        {
          fontName: { family: "Didot", style: "Regular" },
        },
      ];
    },
    async loadFontAsync(font: { family: string; style: string }) {
      attemptedFonts.push(font);
      if (
        (font.family === "Didot" && font.style === "Regular") ||
        (font.family === "Didot" && font.style === "Semibold")
      ) {
        return;
      }
      throw new Error("missing");
    },
    createText() {
      return {
        id: `9:${nextTextId++}`,
        type: "TEXT",
        name: "Text",
        parent: null as any,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        fills: [] as any[],
        fontName: null as any,
        characters: "",
        lineHeight: null as any,
        letterSpacing: null as any,
        textAlignHorizontal: "LEFT",
        textAutoResize: "NONE",
        resize(width: number, height: number) {
          this.width = width;
          this.height = height;
        },
        setSharedPluginData() {},
      };
    },
  };

  const successResult = (
    capabilityId: any,
    message: string,
    details?: Record<string, unknown>,
  ) => ({
    capabilityId,
    ok: true,
    changedNodeIds: [],
    createdStyleIds: [],
    createdVariableIds: [],
    exportedImages: [],
    inspectedNodes: [],
    warnings: [],
    errorCode: null,
    message,
    ...(details || {}),
  });

  const result = await tryRunCreationCapabilityCommand(
    {
      type: "capability",
      capabilityId: "nodes.create-text",
      payload: {
        content: "Shadow Of Elegance",
        fontFamily: "Didot",
        fontFamilyCandidates: ["Didot", "Bodoni 72"],
        fontWeight: 600,
        resolvedBrowserFontFamily: "Didot",
        resolvedBrowserFontStyle: "Semibold",
        width: 320,
        height: 120,
        parentNodeId: "0:1",
        analysisRefId: "code-to-design:text-headline",
      },
    } as any,
    undefined,
    {
      getTargetNodes: async () => [],
      resolveBatchNodeId: (value) => value,
      registerAnalysisRefId() {},
      persistAnalysisRefId() {},
      successResult,
    },
  );

  assert.equal(result?.ok, true);
  assert.deepEqual(attemptedFonts, [{ family: "Didot", style: "Semibold" }]);
});

test("nodes.create-text still rejects when the browser-resolved font cannot be loaded directly", async () => {
  const currentPage = {
    id: "0:1",
    type: "PAGE",
    name: "Page 1",
    children: [] as any[],
    appendChild(child: any) {
      child.parent = currentPage;
      currentPage.children.push(child);
      return child;
    },
  };

  (globalThis as any).figma = {
    mixed: Symbol("mixed"),
    currentPage,
    async getNodeByIdAsync(id: string) {
      return id === "0:1" ? currentPage : null;
    },
    async listAvailableFontsAsync() {
      return [
        {
          fontName: { family: "Didot", style: "Regular" },
        },
      ];
    },
    async loadFontAsync(font: { family: string; style: string }) {
      if (font.family === "Didot" && font.style === "Regular") {
        return;
      }
      throw new Error("missing");
    },
    createText() {
      return {
        id: "9:1",
        type: "TEXT",
        name: "Text",
        parent: null as any,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        fills: [] as any[],
        fontName: null as any,
        characters: "",
        lineHeight: null as any,
        letterSpacing: null as any,
        textAlignHorizontal: "LEFT",
        textAutoResize: "NONE",
        resize() {},
        setSharedPluginData() {},
      };
    },
  };

  const successResult = (
    capabilityId: any,
    message: string,
    details?: Record<string, unknown>,
  ) => ({
    capabilityId,
    ok: true,
    changedNodeIds: [],
    createdStyleIds: [],
    createdVariableIds: [],
    exportedImages: [],
    inspectedNodes: [],
    warnings: [],
    errorCode: null,
    message,
    ...(details || {}),
  });

  await assert.rejects(
    () =>
      tryRunCreationCapabilityCommand(
        {
          type: "capability",
          capabilityId: "nodes.create-text",
          payload: {
            content: "Shadow Of Elegance",
            fontFamily: "Didot",
            fontFamilyCandidates: ["Didot", "Bodoni 72"],
            fontWeight: 600,
            resolvedBrowserFontFamily: "Didot",
            resolvedBrowserFontStyle: "Semibold",
            width: 320,
            height: 120,
            parentNodeId: "0:1",
            analysisRefId: "code-to-design:text-headline",
          },
        } as any,
        undefined,
        {
          getTargetNodes: async () => [],
          resolveBatchNodeId: (value) => value,
          registerAnalysisRefId() {},
          persistAnalysisRefId() {},
          successResult,
        },
      ),
    /当前 Figma session 未暴露浏览器实际字体/,
  );
});

test("nodes.create-text preserves HEIGHT auto resize after constraining width", async () => {
  const currentPage = {
    id: "0:1",
    type: "PAGE",
    name: "Page 1",
    children: [] as any[],
    appendChild(child: any) {
      child.parent = currentPage;
      currentPage.children.push(child);
      return child;
    },
  };

  let createdTextNode: any = null;
  (globalThis as any).figma = {
    mixed: Symbol("mixed"),
    currentPage,
    async getNodeByIdAsync(id: string) {
      return id === "0:1" ? currentPage : null;
    },
    async listAvailableFontsAsync() {
      return [
        {
          fontName: { family: "Inter", style: "Regular" },
        },
      ];
    },
    async loadFontAsync() {
      return;
    },
    createText() {
      createdTextNode = {
        id: "9:1",
        type: "TEXT",
        name: "Text",
        parent: null as any,
        width: 64,
        height: 24,
        x: 0,
        y: 0,
        fills: [] as any[],
        fontName: null as any,
        characters: "",
        lineHeight: null as any,
        letterSpacing: null as any,
        textAlignHorizontal: "LEFT",
        textAutoResize: "NONE",
        resize(width: number, height: number) {
          this.width = width;
          this.height = height;
        },
        setSharedPluginData() {},
      };
      return createdTextNode;
    },
  };

  const successResult = (
    capabilityId: any,
    message: string,
    details?: Record<string, unknown>,
  ) => ({
    capabilityId,
    ok: true,
    changedNodeIds: [],
    createdStyleIds: [],
    createdVariableIds: [],
    exportedImages: [],
    inspectedNodes: [],
    warnings: [],
    errorCode: null,
    message,
    ...(details || {}),
  });

  const result = await tryRunCreationCapabilityCommand(
    {
      type: "capability",
      capabilityId: "nodes.create-text",
      payload: {
        content: "Probe",
        fontFamily: "Inter",
        fontFamilyCandidates: ["Inter"],
        resolvedBrowserFontFamily: "Inter",
        resolvedBrowserFontStyle: "Regular",
        width: 320,
        textAutoResize: "HEIGHT",
        parentNodeId: "0:1",
      },
    } as any,
    undefined,
    {
      getTargetNodes: async () => [],
      resolveBatchNodeId: (value) => value,
      registerAnalysisRefId() {},
      persistAnalysisRefId() {},
      successResult,
    },
  );

  assert.equal(result?.ok, true);
  assert.equal(createdTextNode?.width, 320);
  assert.equal(createdTextNode?.textAutoResize, "HEIGHT");
});
