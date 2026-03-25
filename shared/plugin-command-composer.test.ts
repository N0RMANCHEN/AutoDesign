import assert from "node:assert/strict";
import test from "node:test";

import { composePluginCommandsFromPrompt } from "./plugin-command-composer.js";

test("composePluginCommandsFromPrompt returns a warning for empty input", () => {
  const result = composePluginCommandsFromPrompt("   ");

  assert.deepEqual(result.batch.commands, []);
  assert.deepEqual(result.warnings, ["自然语言输入为空。"]);
});

test("composePluginCommandsFromPrompt builds rectangle creation with placement, gap, fill and explicit name", () => {
  const result = composePluginCommandsFromPrompt('创建名字 HeroCard 的矩形 240x120 在下方 gap 24 深灰色');

  assert.equal(result.warnings.length, 0);
  assert.equal(result.batch.commands.length, 1);
  assert.deepEqual(result.batch.commands[0], {
    type: "capability",
    capabilityId: "nodes.create-rectangle",
    payload: {
      name: "HeroCard",
      width: 240,
      height: 120,
      fillHex: "#4A4F55",
      placement: "below",
      gap: 24,
    },
  });
});

test("composePluginCommandsFromPrompt splits multi-line prompts into multiple capability commands", () => {
  const result = composePluginCommandsFromPrompt("刷新\n清空填充\n描边粗细 3");

  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "selection.refresh",
      payload: {},
    },
    {
      type: "capability",
      capabilityId: "fills.clear-fill",
      payload: {},
    },
    {
      type: "capability",
      capabilityId: "strokes.set-weight",
      payload: { value: 3 },
    },
  ]);
});

test("composePluginCommandsFromPrompt splits compound text mutations on one line into multiple commands", () => {
  const result = composePluginCommandsFromPrompt("把文本改成 Hello 字体 SF Pro");

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "text.set-content",
      payload: { value: "Hello" },
    },
    {
      type: "capability",
      capabilityId: "text.set-font-family",
      payload: { family: "SF Pro" },
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt keeps multiple text style mutations on one line", () => {
  const result = composePluginCommandsFromPrompt("文字颜色 #111111 字号 24 字体 SF Pro Text 左对齐");

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "text.set-text-color",
      payload: { hex: "#111111" },
    },
    {
      type: "capability",
      capabilityId: "text.set-font-size",
      payload: { value: 24 },
    },
    {
      type: "capability",
      capabilityId: "text.set-alignment",
      payload: { value: "left" },
    },
    {
      type: "capability",
      capabilityId: "text.set-font-family",
      payload: { family: "SF Pro Text" },
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt keeps compound stroke mutations on one line", () => {
  const result = composePluginCommandsFromPrompt("描边 #222222 粗细 3");

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "strokes.set-weight",
      payload: { value: 3 },
    },
    {
      type: "capability",
      capabilityId: "strokes.set-stroke",
      payload: { hex: "#222222" },
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt keeps distinct fill and stroke colors on one line", () => {
  const result = composePluginCommandsFromPrompt("填充 #111111 描边 #222222 粗细 2");

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "fills.set-fill",
      payload: { hex: "#111111" },
    },
    {
      type: "capability",
      capabilityId: "strokes.set-weight",
      payload: { value: 2 },
    },
    {
      type: "capability",
      capabilityId: "strokes.set-stroke",
      payload: { hex: "#222222" },
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt keeps compound shadow and blur mutations on one line", () => {
  const result = composePluginCommandsFromPrompt("阴影 #000000 0 4 16 模糊 8");

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "effects.set-shadow",
      payload: {
        offsetX: 0,
        offsetY: 4,
        blur: 16,
        colorHex: "#000000",
      },
    },
    {
      type: "capability",
      capabilityId: "effects.set-layer-blur",
      payload: { radius: 8 },
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt keeps shadow and fill mutations on one line", () => {
  const result = composePluginCommandsFromPrompt("阴影 #000000 0 4 16 填充 #FFFFFF");

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "fills.set-fill",
      payload: { hex: "#FFFFFF" },
    },
    {
      type: "capability",
      capabilityId: "effects.set-shadow",
      payload: {
        offsetX: 0,
        offsetY: 4,
        blur: 16,
        colorHex: "#000000",
      },
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt keeps compound geometry mutations on one line", () => {
  const result = composePluginCommandsFromPrompt("尺寸 320 180 位置 24 48");

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "geometry.set-size",
      payload: {
        width: 320,
        height: 180,
      },
    },
    {
      type: "capability",
      capabilityId: "geometry.set-position",
      payload: {
        x: 24,
        y: 48,
      },
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt keeps geometry and fill mutations on one line", () => {
  const result = composePluginCommandsFromPrompt("尺寸 320 180 填充 #111111");

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "geometry.set-size",
      payload: {
        width: 320,
        height: 180,
      },
    },
    {
      type: "capability",
      capabilityId: "fills.set-fill",
      payload: { hex: "#111111" },
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt keeps compound radius and opacity mutations on one line", () => {
  const result = composePluginCommandsFromPrompt("圆角 16 透明度 80");

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "geometry.set-radius",
      payload: { value: 16 },
    },
    {
      type: "capability",
      capabilityId: "nodes.set-opacity",
      payload: { value: 80 },
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt keeps fill, radius and opacity mutations on one line", () => {
  const result = composePluginCommandsFromPrompt("填充 #111111 圆角 16 透明度 80");

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "fills.set-fill",
      payload: { hex: "#111111" },
    },
    {
      type: "capability",
      capabilityId: "geometry.set-radius",
      payload: { value: 16 },
    },
    {
      type: "capability",
      capabilityId: "nodes.set-opacity",
      payload: { value: 80 },
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt keeps rename and fill mutations on one line", () => {
  const result = composePluginCommandsFromPrompt("重命名为 Hero 填充 #111111");

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "nodes.rename",
      payload: { name: "Hero" },
    },
    {
      type: "capability",
      capabilityId: "fills.set-fill",
      payload: { hex: "#111111" },
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt keeps duplicate and fill mutations on one line", () => {
  const result = composePluginCommandsFromPrompt("复制 24 48 填充 #111111");

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "nodes.duplicate",
      payload: {
        offsetX: 24,
        offsetY: 48,
      },
    },
    {
      type: "capability",
      capabilityId: "fills.set-fill",
      payload: { hex: "#111111" },
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt keeps group and opacity mutations on one line", () => {
  const result = composePluginCommandsFromPrompt("编组为 Hero 透明度 80");

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "nodes.group",
      payload: { name: "Hero" },
    },
    {
      type: "capability",
      capabilityId: "nodes.set-opacity",
      payload: { value: 80 },
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt keeps frame selection and opacity mutations on one line", () => {
  const result = composePluginCommandsFromPrompt("Frame 包裹 padding 16 透明度 80");

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "nodes.frame-selection",
      payload: { padding: 16 },
    },
    {
      type: "capability",
      capabilityId: "nodes.set-opacity",
      payload: { value: 80 },
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt keeps multiple clear mutations on one line", () => {
  const result = composePluginCommandsFromPrompt("清空填充 清空描边");

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "fills.clear-fill",
      payload: {},
    },
    {
      type: "capability",
      capabilityId: "strokes.clear-stroke",
      payload: {},
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt keeps style apply and opacity mutations on one line", () => {
  const result = composePluginCommandsFromPrompt("应用样式 Primary Card 透明度 80");

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "styles.apply-style",
      payload: {
        styleType: "paint",
        styleName: "Primary Card",
      },
    },
    {
      type: "capability",
      capabilityId: "nodes.set-opacity",
      payload: { value: 80 },
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt keeps text color and opacity mutations on one line", () => {
  const result = composePluginCommandsFromPrompt("文字颜色 #111111 透明度 80");

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "text.set-text-color",
      payload: { hex: "#111111" },
    },
    {
      type: "capability",
      capabilityId: "nodes.set-opacity",
      payload: { value: 80 },
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt keeps style apply and fill mutations on one line without drifting into style upsert", () => {
  const result = composePluginCommandsFromPrompt("应用样式 Primary Card 填充 #111111");

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "styles.apply-style",
      payload: {
        styleType: "paint",
        styleName: "Primary Card",
      },
    },
    {
      type: "capability",
      capabilityId: "fills.set-fill",
      payload: { hex: "#111111" },
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt keeps paint style upsert intent when color and apply appear on the same line", () => {
  const result = composePluginCommandsFromPrompt("样式 Primary Card #111111 应用");

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "styles.upsert-paint-style",
      payload: {
        name: "Primary Card",
        hex: "#111111",
        applyToSelection: true,
      },
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt keeps duplicate and rename mutations on one line", () => {
  const result = composePluginCommandsFromPrompt("复制 24 48 重命名为 Hero Card Copy");

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "nodes.duplicate",
      payload: {
        offsetX: 24,
        offsetY: 48,
      },
    },
    {
      type: "capability",
      capabilityId: "nodes.rename",
      payload: { name: "Hero Card Copy" },
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt treats 名字改成 as rename instead of falling through to fill parsing", () => {
  const result = composePluginCommandsFromPrompt("把名字改成 HeroCard");

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "nodes.rename",
      payload: { name: "HeroCard" },
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt keeps quoted text style name and quoted font family separate", () => {
  const result = composePluginCommandsFromPrompt('创建文字样式 "Title/L" 字体 "SF Pro" 24 #111111');

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "styles.upsert-text-style",
      payload: {
        name: "Title/L",
        fontFamily: "SF Pro",
        fontSize: 24,
        textColorHex: "#111111",
      },
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt keeps unquoted multi-word apply-style targets intact", () => {
  const result = composePluginCommandsFromPrompt("应用样式 Primary Button");

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "styles.apply-style",
      payload: {
        styleType: "paint",
        styleName: "Primary Button",
      },
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt keeps unquoted multi-word font families intact", () => {
  const result = composePluginCommandsFromPrompt("创建文字样式 Title/L 字体 SF Pro 24 #111111");

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "styles.upsert-text-style",
      payload: {
        name: "Title/L",
        fontFamily: "SF Pro",
        fontSize: 24,
        textColorHex: "#111111",
      },
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt keeps unquoted multi-word text style names intact before font clauses", () => {
  const result = composePluginCommandsFromPrompt("创建文字样式 Title Large 字体 SF Pro Text 24 #111111");

  assert.deepEqual(result.batch.commands, [
    {
      type: "capability",
      capabilityId: "styles.upsert-text-style",
      payload: {
        name: "Title Large",
        fontFamily: "SF Pro Text",
        fontSize: 24,
        textColorHex: "#111111",
      },
    },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("composePluginCommandsFromPrompt warns when a supported intent is missing required structured data", () => {
  const result = composePluginCommandsFromPrompt("把文字颜色改一下");

  assert.deepEqual(result.batch.commands, []);
  assert.deepEqual(result.warnings, ["无法从这句里识别文字颜色：把文字颜色改一下"]);
});
