import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { composePluginCommandsFromPrompt } from "../shared/plugin-command-composer.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDirectory = path.resolve(__dirname, "..");
const pluginDistDirectory = path.join(rootDirectory, "plugins/autodesign/dist");

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function verifyBuildArtifacts() {
  const manifestPath = path.join(pluginDistDirectory, "manifest.json");
  const codePath = path.join(pluginDistDirectory, "code.js");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const code = await readFile(codePath, "utf8");

  ensure(manifest.main === "code.js", "plugins/autodesign manifest.main must be code.js.");
  ensure(!("ui" in manifest), "plugins/autodesign manifest.ui should stay unset when UI HTML is injected.");
  ensure(code.includes("figma.showUI("), "plugins/autodesign code.js must call figma.showUI.");
  ensure(
    code.includes("figma.showUI(__html__") || code.includes("<!doctype html>"),
    "plugins/autodesign code.js must contain injected UI HTML.",
  );
}

function verifyPrompt(prompt, expectedCapabilityId) {
  const composition = composePluginCommandsFromPrompt(prompt);
  const command = composition.batch.commands[0];

  ensure(command, `No command generated for prompt: ${prompt}`);
  ensure(command.type === "capability", `Unexpected command type for prompt: ${prompt}`);
  ensure(
    command.capabilityId === expectedCapabilityId,
    `Prompt "${prompt}" mapped to ${command.capabilityId}, expected ${expectedCapabilityId}.`,
  );
}

function verifyNaturalLanguageSmoke() {
  verifyPrompt("把当前选中对象改成粉色", "fills.set-fill");
  verifyPrompt('文本改成 "Hello World"', "text.set-content");
  verifyPrompt("把它们编组", "nodes.group");
  verifyPrompt("包成 Frame 名字 Hero padding 16", "nodes.frame-selection");
  verifyPrompt("创建文字样式 Heading 字体 Inter 24 红色", "styles.upsert-text-style");
}

await verifyBuildArtifacts();
verifyNaturalLanguageSmoke();

console.log("plugin smoke passed");
