import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  composePluginCommandsFromPrompt,
  type PluginCommandComposition,
} from "../shared/plugin-command-composer.js";
import type { PluginCapabilityId } from "../shared/plugin-capabilities.js";
import type {
  PluginBridgeSession,
  PluginBridgeSnapshot,
  QueuePluginCommandPayload,
} from "../shared/plugin-bridge.js";
import type { FigmaPluginCommandBatch } from "../shared/plugin-contract.js";

const BASE_URL = process.env.FIGMATEST_API_URL ?? "http://localhost:3001";

type Mode = "status" | "send" | "preview";
type PreviewTarget = {
  index: number;
  node: PluginBridgeSession["selection"][number];
};

function fail(message: string): never {
  throw new Error(message);
}

function parseMode(argv: string[]): Mode {
  const mode = argv[2];
  if (mode === "status" || mode === "send" || mode === "preview") {
    return mode;
  }
  fail(
    "Usage: npm run plugin:status OR npm run plugin:send -- --prompt \"把当前选中对象改成粉色\" OR npm run plugin:preview",
  );
}

function readFlag(argv: string[], name: string) {
  const index = argv.indexOf(name);
  if (index < 0) {
    return null;
  }
  return argv[index + 1] ?? null;
}

async function requestJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init && init.headers ? init.headers : {}),
    },
  });

  if (!response.ok) {
    fail(`Request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

function sortSessions(sessions: PluginBridgeSession[]) {
  return [...sessions].sort((left, right) =>
    right.lastSeenAt.localeCompare(left.lastSeenAt),
  );
}

function pickSession(
  sessions: PluginBridgeSession[],
  explicitSessionId: string | null,
) {
  if (!sessions.length) {
    fail("当前没有在线插件会话。请先在 Figma 里打开 Codex to Figma。");
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

function parseBatchFromArgs(argv: string[]) {
  const prompt = readFlag(argv, "--prompt");
  const json = readFlag(argv, "--json");

  if (prompt && json) {
    fail("只能使用一种输入方式：--prompt 或 --json。");
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

  fail("send 模式必须提供 --prompt 或 --json。");
}

function printSelection(session: PluginBridgeSession) {
  if (!session.selection.length) {
    console.log("selection: empty");
    return;
  }

  for (const node of session.selection) {
    console.log(
      `- ${node.name} [${node.type}] fills=${node.fills.join(", ") || "none"} fillStyleId=${node.fillStyleId || "none"}`,
    );
  }
}

function printCapabilities(session: PluginBridgeSession) {
  if (!session.capabilities.length) {
    console.log("capabilities: none");
    return;
  }

  console.log(
    `capabilities: ${session.capabilities.map((item) => item.id).join(", ")}`,
  );
}

function collectCapabilityIds(batch: FigmaPluginCommandBatch) {
  const ids = new Set<PluginCapabilityId>();

  for (const command of batch.commands) {
    if (command.type === "capability") {
      ids.add(command.capabilityId);
      continue;
    }

    switch (command.type) {
      case "refresh-selection":
        ids.add("selection.refresh");
        break;
      case "set-selection-fill":
        ids.add("fills.set-fill");
        break;
      case "set-selection-stroke":
        ids.add("strokes.set-stroke");
        break;
      case "set-selection-radius":
        ids.add("geometry.set-radius");
        break;
      case "set-selection-opacity":
        ids.add("nodes.set-opacity");
        break;
      case "create-or-update-paint-style":
        ids.add("styles.upsert-paint-style");
        break;
      case "create-or-update-color-variable":
        ids.add("variables.upsert-color-variable");
        break;
    }
  }

  return [...ids];
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
  const { batch, composition } = parseBatchFromArgs(argv);
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

  await runSend(process.argv);
})().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(message);
  process.exitCode = 1;
});
