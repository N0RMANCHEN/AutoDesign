import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  composePluginCommandsFromPrompt,
  type PluginCommandComposition,
} from "../shared/plugin-command-composer.js";
import type {
  PluginBridgeCommandRecord,
  InspectFrameResponsePayload,
  PluginBridgeSession,
  PluginBridgeSnapshot,
  PluginNodeInspection,
  QueuePluginCommandPayload,
} from "../shared/plugin-bridge.js";
import type { FigmaPluginCommandBatch } from "../shared/plugin-contract.js";
import {
  collectCapabilityIds,
  prepareBatchForExternalDispatch,
} from "../shared/plugin-targeting.js";
import {
  ensureExplicitTargetingForMutations,
  ensureSafeMutationBatch,
  parseNodeIds,
} from "../shared/plugin-cli-guards.js";
import { runReconstruct as runReconstructMode } from "./plugin-bridge-cli-reconstruct.js";

const BASE_URL =
  process.env.AUTODESIGN_API_URL ??
  process.env.FIGMATEST_API_URL ??
  "http://localhost:3001";
const apiFixtureDirectory = process.env.AUTODESIGN_API_FIXTURE_DIR
  ? path.resolve(process.env.AUTODESIGN_API_FIXTURE_DIR)
  : null;

type Mode = "status" | "send" | "preview" | "inspect" | "reconstruct";
type PreviewTarget = {
  index: number;
  node: PluginBridgeSession["selection"][number];
};

const COMMAND_WAIT_TIMEOUT_MS = 30_000;
const COMMAND_WAIT_POLL_INTERVAL_MS = 300;

function fail(message: string): never {
  throw new Error(message);
}

function parseMode(argv: string[]): Mode {
  const mode = argv[2];
  if (mode === "status" || mode === "send" || mode === "preview" || mode === "inspect") {
    return mode;
  }
  if (mode === "reconstruct") {
    return mode;
  }
  fail(
    "Usage: npm run plugin:status OR npm run plugin:inspect OR npm run plugin:send -- --prompt \"把当前选中对象改成粉色\" OR npm run plugin:preview OR npm run plugin:reconstruct",
  );
}

function readFlag(argv: string[], name: string) {
  const index = argv.indexOf(name);
  if (index < 0) {
    return null;
  }
  return argv[index + 1] ?? null;
}

function readValueFlag(argv: string[], name: string) {
  const value = readFlag(argv, name);
  if (!value || value.startsWith("--")) {
    return null;
  }
  return value;
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const fs = await import("node:fs/promises");
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

function toFixtureName(pathname: string, method: string) {
  const normalizedPath = pathname.replace(/^\//, "").replace(/[/?=&:]+/g, "__");
  const normalizedMethod = method.toLowerCase();
  return `${normalizedMethod}__${normalizedPath || "root"}.json`;
}

async function requestJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  if (apiFixtureDirectory) {
    const method = String(init?.method || "GET").toUpperCase();
    const fixturePath = path.join(apiFixtureDirectory, toFixtureName(pathname, method));
    return readJsonFile<T>(fixturePath);
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${pathname}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init && init.headers ? init.headers : {}),
      },
    });
  } catch (error) {
    fail(
      `Request failed: ${BASE_URL}${pathname} (${error instanceof Error ? error.message : "network error"})`,
    );
  }

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) {
        detail = `${detail} - ${payload.error}`;
      }
    } catch {
      // Ignore non-JSON error bodies.
    }
    fail(`Request failed: ${detail}`);
  }

  return (await response.json()) as T;
}

function sortSessions(sessions: PluginBridgeSession[]) {
  return [...sessions].sort((left, right) =>
    right.lastSeenAt.localeCompare(left.lastSeenAt),
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForQueuedCommand(commandId: string, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const snapshot = await requestJson<PluginBridgeSnapshot>("/api/plugin-bridge");
    const command = snapshot.commands.find((item) => item.id === commandId) || null;
    if (command && (command.status === "succeeded" || command.status === "failed")) {
      return command;
    }
    await sleep(COMMAND_WAIT_POLL_INTERVAL_MS);
  }
  fail(`Timed out waiting for plugin command ${commandId}.`);
}

async function maybeWriteCommandRecord(
  command: PluginBridgeCommandRecord,
  outputPath: string | null,
) {
  if (!outputPath) {
    return;
  }
  const resolvedOutputPath = path.resolve(outputPath);
  await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, `${JSON.stringify(command, null, 2)}\n`, "utf8");
}

function printCommandResults(command: PluginBridgeCommandRecord) {
  console.log(`status: ${command.status}`);
  if (command.resultMessage) {
    console.log(`result: ${command.resultMessage}`);
  }
  if (!command.results.length) {
    console.log("results: none");
    return;
  }
  console.log("results:");
  for (const [index, result] of command.results.entries()) {
    console.log(
      `- [${index}] ${result.capabilityId} ok=${result.ok ? "yes" : "no"} changed=${result.changedNodeIds.length} warnings=${result.warnings.length} receipts=${result.createdNodeReceipts?.length || 0} exports=${result.exportedImages.length} inspected=${result.inspectedNodes.length}`,
    );
    if (result.message) {
      console.log(`  message=${result.message}`);
    }
    if (result.errorCode) {
      console.log(`  errorCode=${result.errorCode}`);
    }
    if (result.warnings.length) {
      console.log(`  warnings=${result.warnings.join(" | ")}`);
    }
  }
}

function pickSession(
  sessions: PluginBridgeSession[],
  explicitSessionId: string | null,
) {
  if (!sessions.length) {
    fail("当前没有在线插件会话。请先在 Figma 里打开 AutoDesign。");
  }

  if (explicitSessionId) {
    const found = sessions.find((session) => session.id === explicitSessionId);
    if (!found) {
      fail(`没有找到 session: ${explicitSessionId}`);
    }
    return found;
  }

  return sortSessions(sessions)[0];
}

async function parseBatchFromArgs(argv: string[]) {
  const prompt = readFlag(argv, "--prompt");
  const json = readFlag(argv, "--json");
  const jsonFile = readValueFlag(argv, "--json-file");

  if ([prompt, json, jsonFile].filter(Boolean).length > 1) {
    fail("只能使用一种输入方式：--prompt、--json 或 --json-file。");
  }

  if (prompt) {
    const composition = composePluginCommandsFromPrompt(prompt);
    if (!composition.batch.commands.length) {
      fail(
        composition.warnings[0] || "没有生成任何插件命令。请调整描述后再试。",
      );
    }
    return {
      batch: composition.batch,
      composition,
    };
  }

  if (json) {
    let parsed: FigmaPluginCommandBatch;
    try {
      parsed = JSON.parse(json) as FigmaPluginCommandBatch;
    } catch (error) {
      fail(error instanceof Error ? `JSON 解析失败：${error.message}` : "JSON 解析失败。");
    }

    if (!Array.isArray(parsed.commands) || !parsed.commands.length) {
      fail("命令 JSON 里没有 commands。");
    }

    return {
      batch: parsed,
      composition: null,
    };
  }

  if (jsonFile) {
    let parsed: FigmaPluginCommandBatch;
    try {
      parsed = JSON.parse(await readFile(path.resolve(jsonFile), "utf8")) as FigmaPluginCommandBatch;
    } catch (error) {
      fail(error instanceof Error ? `JSON 文件读取失败：${error.message}` : "JSON 文件读取失败。");
    }

    if (!Array.isArray(parsed.commands) || !parsed.commands.length) {
      fail("命令 JSON 文件里没有 commands。");
    }

    return {
      batch: parsed,
      composition: null,
    };
  }

  fail("send 模式必须提供 --prompt、--json 或 --json-file。");
}

function printSelection(session: PluginBridgeSession) {
  if (!session.selection.length) {
    console.log("selection: empty");
    return;
  }

  for (const [index, node] of session.selection.entries()) {
    console.log(
      `- [${index}] ${node.name} [${node.type}] id=${node.id} fills=${node.fills.join(", ") || "none"} fillStyleId=${node.fillStyleId || "none"} size=${node.width ?? "?"}x${node.height ?? "?"} local=(${node.x ?? "?"}, ${node.y ?? "?"}) abs=(${node.absoluteX ?? "?"}, ${node.absoluteY ?? "?"}) parent=${node.parentNodeType || "none"}:${node.parentNodeId || "none"} parentLayout=${node.parentLayoutMode || "none"} layout=${node.layoutMode || "none"} positioning=${node.layoutPositioning || "none"}`,
    );
  }
}

function printCapabilities(session: PluginBridgeSession) {
  if (!session.capabilities.length) {
    console.log("capabilities: none");
  } else {
    console.log(
      `capabilities: ${session.capabilities.map((item) => item.id).join(", ")}`,
    );
  }
  console.log(
    `runtimeFeatures: explicitNodeTargeting=${session.runtimeFeatures?.supportsExplicitNodeTargeting ? "yes" : "no"}`,
  );
}

function formatNumberish(value: number | string | null | undefined) {
  if (value === null || value === undefined) {
    return "?";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return String(value);
}

function printInspectedFrameNodes(nodes: PluginNodeInspection[]) {
  if (!nodes.length) {
    console.log("frameNodes: empty");
    return;
  }

  console.log("frameNodes:");
  for (const node of nodes) {
    const indent = "  ".repeat(Math.max(0, node.depth));
    const geometry = `pos=(${formatNumberish(node.x)}, ${formatNumberish(node.y)}) size=${formatNumberish(node.width)}x${formatNumberish(node.height)}`;
    const visual = [
      `fills=${node.fills.join(", ") || "none"}`,
      `strokes=${node.strokes?.join(", ") || "none"}`,
      `opacity=${formatNumberish(node.opacity)}`,
      `radius=${formatNumberish(node.cornerRadius)}`,
    ].join(" ");
    const meta = [
      `id=${node.id}`,
      node.analysisRefId ? `analysisRef=${node.analysisRefId}` : null,
      `type=${node.type}`,
      `children=${node.childCount}`,
      `index=${node.indexWithinParent}`,
      `generated=${node.generatedBy || "no"}`,
      `visible=${node.visible === null || node.visible === undefined ? "?" : node.visible ? "yes" : "no"}`,
      `locked=${node.locked === null || node.locked === undefined ? "?" : node.locked ? "yes" : "no"}`,
    ]
      .filter(Boolean)
      .join(" ");
    console.log(`${indent}- ${node.name} | ${meta} | ${geometry} | ${visual}`);
    const layoutDetails = [
      node.layoutMode ? `layout=${node.layoutMode}` : null,
      node.layoutPositioning ? `positioning=${node.layoutPositioning}` : null,
      node.layoutAlign ? `align=${node.layoutAlign}` : null,
      node.layoutGrow !== null && node.layoutGrow !== undefined ? `grow=${formatNumberish(node.layoutGrow)}` : null,
      node.primaryAxisSizingMode ? `primarySize=${node.primaryAxisSizingMode}` : null,
      node.counterAxisSizingMode ? `counterSize=${node.counterAxisSizingMode}` : null,
      node.itemSpacing !== null && node.itemSpacing !== undefined ? `gap=${formatNumberish(node.itemSpacing)}` : null,
      [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft].some((value) => value !== null && value !== undefined)
        ? `padding=${formatNumberish(node.paddingTop)}/${formatNumberish(node.paddingRight)}/${formatNumberish(node.paddingBottom)}/${formatNumberish(node.paddingLeft)}`
        : null,
      node.constraintsHorizontal || node.constraintsVertical
        ? `constraints=${node.constraintsHorizontal || "?"}/${node.constraintsVertical || "?"}`
        : null,
      node.clipsContent !== null && node.clipsContent !== undefined ? `clips=${node.clipsContent ? "yes" : "no"}` : null,
      node.isMask !== null && node.isMask !== undefined ? `mask=${node.isMask ? "yes" : "no"}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    if (layoutDetails) {
      console.log(`${indent}  ${layoutDetails}`);
    }
    const componentDetails = [
      node.mainComponentId ? `mainComponent=${node.mainComponentName || "?"}(${node.mainComponentId})` : null,
      node.componentPropertyDefinitionKeys?.length ? `componentDefs=${node.componentPropertyDefinitionKeys.join(",")}` : null,
      node.componentPropertyReferences?.length ? `componentRefs=${node.componentPropertyReferences.join(",")}` : null,
      node.variantProperties && Object.keys(node.variantProperties).length
        ? `variants=${Object.entries(node.variantProperties)
            .map(([key, value]) => `${key}=${value}`)
            .join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join(" ");
    if (componentDetails) {
      console.log(`${indent}  ${componentDetails}`);
    }
    if (node.textContent) {
      console.log(
        `${indent}  text="${node.textContent.replace(/\s+/g, " ").slice(0, 120)}" font=${node.fontFamily || "?"}/${node.fontStyle || "?"} size=${formatNumberish(node.fontSize)} weight=${formatNumberish(node.fontWeight)} align=${node.textAlignment || "?"}`,
      );
    }
  }
}

function printComposition(composition: PluginCommandComposition | null) {
  if (!composition) {
    return;
  }

  if (composition.notes.length) {
    console.log("notes:");
    for (const note of composition.notes) {
      console.log(`- ${note}`);
    }
  }

  if (composition.warnings.length) {
    console.log("warnings:");
    for (const warning of composition.warnings) {
      console.log(`- ${warning}`);
    }
  }
}

function sanitizeFileSegment(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "selection";
}

function parsePreviewDataUrl(node: PluginBridgeSession["selection"][number]) {
  if (!node.previewDataUrl) {
    fail(`节点 ${node.name} 当前没有可用预览。请重新打开插件并重新选中图片后再试。`);
  }

  const match = /^data:image\/png;base64,(.+)$/.exec(node.previewDataUrl);
  if (!match) {
    fail(`节点 ${node.name} 的预览数据格式无效。`);
  }

  return Buffer.from(match[1], "base64");
}

function parseArtifactDataUrl(dataUrl: string, label: string) {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!match) {
    fail(`${label} 的预览数据格式无效。`);
  }
  return Buffer.from(match[1], "base64");
}

function pickPreviewTargets(
  session: PluginBridgeSession,
  explicitIndex: string | null,
): PreviewTarget[] {
  const previewable = session.selection
    .map((node, index) => ({
      index,
      node,
    }))
    .filter((entry) => Boolean(entry.node.previewDataUrl));

  if (!previewable.length) {
    fail("当前 selection 没有可导出的预览。请重新打开插件并选中图片节点。");
  }

  if (explicitIndex === null) {
    return previewable;
  }

  const index = Number.parseInt(explicitIndex, 10);
  if (Number.isNaN(index)) {
    fail(`无效的 --index: ${explicitIndex}`);
  }

  const target = previewable.find((entry) => entry.index === index);
  if (!target) {
    fail(`selection 中不存在 index=${index} 的可预览节点。`);
  }

  return [target];
}

async function runStatus() {
  const snapshot = await requestJson<PluginBridgeSnapshot>("/api/plugin-bridge");
  const sessions = sortSessions(snapshot.sessions);

  if (!sessions.length) {
    console.log("当前没有在线插件会话。");
    return;
  }

  for (const session of sessions) {
    console.log(
      `${session.id} | ${session.label} ${session.pluginVersion} | ${session.status} | ${session.fileName} / ${session.pageName}`,
    );
    printCapabilities(session);
    printSelection(session);
  }
}

async function runSend(argv: string[]) {
  const snapshot = await requestJson<PluginBridgeSnapshot>("/api/plugin-bridge");
  const session = pickSession(snapshot.sessions, readFlag(argv, "--session"));
  const { batch: rawBatch, composition } = await parseBatchFromArgs(argv);
  const nodeIds = parseNodeIds(readFlag(argv, "--node-ids"));
  try {
    ensureExplicitTargetingForMutations(rawBatch, session, nodeIds);
  } catch (error) {
    fail(error instanceof Error ? error.message : "外部命令 nodeIds 校验失败。");
  }
  const batch = prepareBatchForExternalDispatch(rawBatch, nodeIds);
  try {
    ensureSafeMutationBatch(batch);
  } catch (error) {
    fail(error instanceof Error ? error.message : "外部命令批次校验失败。");
  }
  const payload: QueuePluginCommandPayload = {
    targetSessionId: session.id,
    source: "codex",
    payload: batch,
  };
  const batchCapabilityIds = collectCapabilityIds(batch);
  const availableCapabilities = new Set(session.capabilities.map((item) => item.id));
  const unsupportedCapabilities = batchCapabilityIds.filter(
    (capabilityId) => !availableCapabilities.has(capabilityId),
  );

  if (unsupportedCapabilities.length) {
    fail(`目标插件当前不支持这些能力：${unsupportedCapabilities.join(", ")}`);
  }

  const result = await requestJson<{ id: string }>(
    "/api/plugin-bridge/commands",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );

  console.log(`queued: ${result.id}`);
  console.log(`session: ${session.id}`);
  console.log(`target: ${session.fileName} / ${session.pageName}`);
  printCapabilities(session);
  printSelection(session);
  printComposition(composition);
  console.log("payload:");
  console.log(JSON.stringify(batch, null, 2));

  if (!argv.includes("--wait")) {
    return;
  }

  const timeoutMsRaw = readValueFlag(argv, "--timeout-ms");
  const timeoutMs = timeoutMsRaw ? Number.parseInt(timeoutMsRaw, 10) : COMMAND_WAIT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    fail(`invalid --timeout-ms: ${timeoutMsRaw}`);
  }
  const completedCommand = await waitForQueuedCommand(result.id, timeoutMs);
  await maybeWriteCommandRecord(completedCommand, readValueFlag(argv, "--result-out"));
  printCommandResults(completedCommand);
}

async function runPreview(argv: string[]) {
  const snapshot = await requestJson<PluginBridgeSnapshot>("/api/plugin-bridge");
  const session = pickSession(snapshot.sessions, readFlag(argv, "--session"));
  const targets = pickPreviewTargets(session, readFlag(argv, "--index"));
  const outputDirectory =
    readFlag(argv, "--out") || path.join(process.cwd(), "data", "plugin-previews");

  await mkdir(outputDirectory, { recursive: true });

  for (const target of targets) {
    const fileName = `${session.id}-${target.index}-${sanitizeFileSegment(target.node.name)}.png`;
    const filePath = path.join(outputDirectory, fileName);
    await writeFile(filePath, parsePreviewDataUrl(target.node));
    console.log(filePath);
  }
}

async function runInspect(argv: string[]) {
  const snapshot = await requestJson<PluginBridgeSnapshot>("/api/plugin-bridge");
  const session = pickSession(snapshot.sessions, readFlag(argv, "--session"));
  const frameNodeId = readFlag(argv, "--frame-node-id");
  const outputDirectory =
    readFlag(argv, "--out") || path.join(process.cwd(), "data", "plugin-previews");

  await mkdir(outputDirectory, { recursive: true });

  if (frameNodeId) {
    if (!session.capabilities.some((capability) => capability.id === "nodes.inspect-subtree")) {
      fail(`当前在线插件会话 ${session.id} 还不支持 nodes.inspect-subtree。请在 Figma 里重新打开 AutoDesign 插件后再试。`);
    }
    const payload = await requestJson<InspectFrameResponsePayload>("/api/plugin-bridge/inspect-frame", {
      method: "POST",
      body: JSON.stringify({
        targetSessionId: session.id,
        frameNodeId,
        maxDepth: (() => {
          const raw = readFlag(argv, "--max-depth");
          const value = raw ? Number.parseInt(raw, 10) : Number.NaN;
          return Number.isFinite(value) ? value : undefined;
        })(),
        includePreview: !argv.includes("--no-preview"),
      }),
    });

    console.log(
      `${session.id} | ${session.label} ${session.pluginVersion} | ${session.status} | ${session.fileName} / ${session.pageName}`,
    );
    printInspectedFrameNodes(payload.nodes);
    if (payload.preview) {
      const fileName = `${session.id}-frame-${sanitizeFileSegment(frameNodeId)}-${sanitizeFileSegment(payload.nodes[0]?.name || "preview")}.png`;
      const filePath = path.join(outputDirectory, fileName);
      await writeFile(filePath, parseArtifactDataUrl(payload.preview.dataUrl, `Frame ${frameNodeId}`));
      console.log(`preview: ${filePath}`);
    }
    return;
  }

  console.log(
    `${session.id} | ${session.label} ${session.pluginVersion} | ${session.status} | ${session.fileName} / ${session.pageName}`,
  );
  printCapabilities(session);
  printSelection(session);
  const targets = pickPreviewTargets(session, readFlag(argv, "--index"));

  console.log("previews:");
  for (const target of targets) {
    const fileName = `${session.id}-${target.index}-${sanitizeFileSegment(target.node.name)}.png`;
    const filePath = path.join(outputDirectory, fileName);
    await writeFile(filePath, parsePreviewDataUrl(target.node));
    console.log(`- [${target.index}] ${filePath}`);
  }
}

async function runReconstruct(argv: string[]) {
  await runReconstructMode(argv, {
    readFlag,
    readValueFlag,
    readJsonFile,
    requestJson,
    pickSession,
  });
}

void (async () => {
  const mode = parseMode(process.argv);
  if (mode === "status") {
    await runStatus();
    return;
  }

  if (mode === "preview") {
    await runPreview(process.argv);
    return;
  }

  if (mode === "inspect") {
    await runInspect(process.argv);
    return;
  }

  if (mode === "reconstruct") {
    await runReconstruct(process.argv);
    return;
  }

  await runSend(process.argv);
})().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(message);
  process.exitCode = 1;
});
