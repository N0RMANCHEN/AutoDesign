import type { PluginBridgeSession, PluginNodeSummary } from "./plugin-bridge.js";

export type RuntimePluginTargetResolution =
  | {
      ok: true;
      nodeId: string;
      selectionNode: PluginNodeSummary | null;
    }
  | {
      ok: false;
      error: string;
    };

export function resolveRuntimePluginTarget(params: {
  session: PluginBridgeSession;
  nodeId?: string | null;
}): RuntimePluginTargetResolution {
  const explicitNodeId = typeof params.nodeId === "string" ? params.nodeId.trim() : "";
  if (explicitNodeId) {
    return {
      ok: true,
      nodeId: explicitNodeId,
      selectionNode: params.session.selection.find((item) => item.id === explicitNodeId) ?? null,
    };
  }

  if (params.session.selection.length === 1) {
    return {
      ok: true,
      nodeId: params.session.selection[0]!.id,
      selectionNode: params.session.selection[0]!,
    };
  }

  if (params.session.selection.length === 0) {
    return {
      ok: false,
      error: "当前插件会话没有 selection，且请求未显式提供 nodeId。",
    };
  }

  return {
    ok: false,
    error: "当前插件会话包含多个 selection；请显式提供 nodeId。",
  };
}
