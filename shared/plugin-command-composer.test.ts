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
      name: "HeroCard 的矩形 240x120 在下方 gap 24 深灰色",
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

test("composePluginCommandsFromPrompt warns when a supported intent is missing required structured data", () => {
  const result = composePluginCommandsFromPrompt("把文字颜色改一下");

  assert.deepEqual(result.batch.commands, []);
  assert.deepEqual(result.warnings, ["无法从这句里识别文字颜色：把文字颜色改一下"]);
});
