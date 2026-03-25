import { useEffect, useState } from "react";

import {
  composePluginCommandsFromPrompt,
  type PluginCommandComposition,
} from "../../../shared/plugin-command-composer";
import type { FigmaPluginCommandBatch } from "../../../shared/plugin-contract";
import type { RuntimeBridgeDispatchReceipt } from "../../../shared/runtime-bridge-dispatch";
import type { RuntimeBridgeOverview } from "../../../shared/runtime-bridge-overview";
import type { RuntimeDesignContext } from "../../../shared/runtime-design-context";
import type {
  ContextPack,
  FigmaSyncPayload,
  RuntimeAction,
  RuntimeEnvelope,
} from "../../../shared/types";
import type {
  WorkspaceMappingStatusReceipt,
  WorkspaceReadModel,
  WorkspaceReviewQueueUpdateReceipt,
} from "../../../shared/workspace-read-model";
import {
  WorkspaceBridgeCommandPanel,
  WorkspaceBridgeStatusPanel,
} from "./bridge-panels";
import {
  WorkspaceDataColumns,
  type ReviewQueueDraft,
} from "./data-panels";
import { Panel } from "./panel";
import { WorkspaceRuntimePanels } from "./runtime-panels";
import { StatusPill } from "./status-pill";

const defaultSyncPayload = JSON.stringify(
  {
    source: {
      name: "Payments Flow",
      figmaFileKey: "MCP-FILE-001",
      branch: "handoff",
      summary: "模拟从 Figma MCP 推送一份支付流程设计快照。",
    },
    screens: [
      {
        name: "Payment / Confirm",
        purpose: "验证确认页信息层级和按钮状态。",
        stateNotes: ["default", "submitting", "error"],
        summary: "适合作为 MCP 推送后的联调验证样本。",
      },
    ],
    components: [
      {
        designName: "Payment Confirm Card",
        reactName: "PaymentConfirmCard",
        props: ["amount", "recipient", "fee", "onSubmit"],
        states: ["default", "submitting", "error"],
        notes: "同步后默认落成 prototype 状态，等待人工确认。",
      },
    ],
  },
  null,
  2,
);

const defaultPluginCommands: FigmaPluginCommandBatch = {
  source: "codex",
  commands: [
    {
      type: "set-selection-fill",
      hex: "#FF6FAE",
    },
    {
      type: "create-or-update-color-variable",
      collectionName: "Brand",
      variableName: "pink/500",
      hex: "#FF6FAE",
      bindToSelection: true,
    },
  ],
};

const actionOptions: RuntimeAction[] = [
  "codegraph/summarize",
  "codegraph/branch",
  "codegraph/reorganize_to_frame",
  "knowledge/summarize",
  "knowledge/branch",
  "knowledge/learning_path",
];

const defaultNaturalLanguagePrompt =
  "把当前选中对象改成粉色；描边改成蓝色；圆角 16；透明度 92；变量 Brand/pink/500 #FF6FAE 绑定";

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

function buildDesignContextRequestKey(params: {
  selectionIds: string[];
  action: RuntimeAction;
  targetSessionId: string;
  workspaceUpdatedAt: string;
}) {
  return JSON.stringify({
    selectionIds: params.selectionIds,
    action: params.action,
    targetSessionId: params.targetSessionId,
    workspaceUpdatedAt: params.workspaceUpdatedAt,
  });
}

function reconcileSelectionIds(params: {
  current: string[];
  workspace: WorkspaceReadModel;
}) {
  const availableIds = new Set(params.workspace.selection.options.map((item) => item.id));
  const current = params.current.filter((id) => availableIds.has(id));
  if (current.length > 0) {
    return current;
  }
  return params.workspace.selection.defaultIds.filter((id) => availableIds.has(id));
}

function reconcileReviewQueueDrafts(params: {
  current: Record<string, ReviewQueueDraft>;
  workspace: WorkspaceReadModel;
}) {
  const validIds = new Set(params.workspace.reviewQueue.map((item) => item.id));
  return Object.fromEntries(
    Object.entries(params.current).filter(([reviewId]) => validIds.has(reviewId)),
  );
}

export function WorkspaceShell() {
  const [workspaceModel, setWorkspaceModel] = useState<WorkspaceReadModel | null>(null);
  const [selectionIds, setSelectionIds] = useState<string[]>([]);
  const [designContext, setDesignContext] = useState<RuntimeDesignContext | null>(null);
  const [designContextRequestKey, setDesignContextRequestKey] = useState<string | null>(null);
  const [contextPack, setContextPack] = useState<ContextPack | null>(null);
  const [runtimeOutput, setRuntimeOutput] = useState<RuntimeEnvelope | null>(null);
  const [activeAction, setActiveAction] =
    useState<RuntimeAction>("codegraph/summarize");
  const [syncPayload, setSyncPayload] = useState(defaultSyncPayload);
  const [pluginCommands, setPluginCommands] = useState(
    JSON.stringify(defaultPluginCommands, null, 2),
  );
  const [naturalLanguagePrompt, setNaturalLanguagePrompt] = useState(
    defaultNaturalLanguagePrompt,
  );
  const [commandComposition, setCommandComposition] = useState<PluginCommandComposition | null>(
    null,
  );
  const [bridgeOverview, setBridgeOverview] = useState<RuntimeBridgeOverview | null>(null);
  const [lastBridgeDispatchReceipt, setLastBridgeDispatchReceipt] =
    useState<RuntimeBridgeDispatchReceipt | null>(null);
  const [selectedBridgeSessionId, setSelectedBridgeSessionId] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [bridgeMessage, setBridgeMessage] = useState("");
  const [reviewMessage, setReviewMessage] = useState("");
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewQueueDraft>>({});
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    void loadWorkspaceReadModel();
    void loadBridgeOverview(false);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadBridgeOverview(false);
    }, 3000);

    return () => window.clearInterval(timer);
  }, []);

  async function loadWorkspaceReadModel() {
    setIsBusy(true);
    try {
      const nextWorkspace = await fetchJson<WorkspaceReadModel>("/api/workspace/read-model");
      setWorkspaceModel(nextWorkspace);
      setSelectionIds((current) =>
        reconcileSelectionIds({
          current,
          workspace: nextWorkspace,
        }),
      );
      setReviewDrafts((current) =>
        reconcileReviewQueueDrafts({
          current,
          workspace: nextWorkspace,
        }),
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function loadBridgeOverview(showBusy: boolean) {
    if (showBusy) {
      setIsBusy(true);
    }

    try {
      const overview = await fetchJson<RuntimeBridgeOverview>("/api/runtime/bridge-overview");
      setBridgeOverview(overview);
      setSelectedBridgeSessionId((current) => {
        if (current && overview.sessions.some((session) => session.id === current)) {
          return current;
        }
        return overview.sessions[0]?.id ?? "";
      });
    } finally {
      if (showBusy) {
        setIsBusy(false);
      }
    }
  }

  function toggleSelection(id: string) {
    setSelectionIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  async function resetWorkspace() {
    setIsBusy(true);
    try {
      const reset = await fetchJson<WorkspaceReadModel>("/api/workspace/reset", {
        method: "POST",
      });
      setWorkspaceModel(reset);
      setSelectionIds(
        reconcileSelectionIds({
          current: [],
          workspace: reset,
        }),
      );
      setDesignContext(null);
      setDesignContextRequestKey(null);
      setContextPack(null);
      setRuntimeOutput(null);
      setLastBridgeDispatchReceipt(null);
      setReviewDrafts({});
      setReviewMessage("");
      setSyncMessage("已重置为内置示例数据。");
    } finally {
      setIsBusy(false);
    }
  }

  async function generateDesignContext() {
    if (!workspaceModel) {
      return;
    }
    setIsBusy(true);
    try {
      const graphKind = activeAction.startsWith("knowledge") ? "knowledge" : "codegraph";
      const targetSessionId = String(selectedBridgeSessionId || "").trim();
      const nextRequestKey = buildDesignContextRequestKey({
        selectionIds,
        action: activeAction,
        targetSessionId,
        workspaceUpdatedAt: workspaceModel.workspace.updatedAt,
      });
      const nextDesignContext = await fetchJson<RuntimeDesignContext>("/api/runtime/design-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectionIds,
          graphKind,
          action: activeAction,
          ...(targetSessionId ? { targetSessionId } : {}),
        }),
      });
      setDesignContext(nextDesignContext);
      setDesignContextRequestKey(nextRequestKey);
      setContextPack(nextDesignContext.contextPack);
      setRuntimeOutput(null);
    } finally {
      setIsBusy(false);
    }
  }

  async function runAction() {
    if (!contextPack) {
      return;
    }
    setIsBusy(true);
    try {
      const result = await fetchJson<RuntimeEnvelope>("/api/runtime/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contextPack),
      });
      setRuntimeOutput(result);
    } finally {
      setIsBusy(false);
    }
  }

  async function submitSyncPayload() {
    setIsBusy(true);
    try {
      const payload = JSON.parse(syncPayload) as FigmaSyncPayload;
      const nextWorkspace = await fetchJson<WorkspaceReadModel>("/api/workspace/figma-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setWorkspaceModel(nextWorkspace);
      setSelectionIds((current) =>
        reconcileSelectionIds({
          current,
          workspace: nextWorkspace,
        }),
      );
      setReviewDrafts((current) =>
        reconcileReviewQueueDrafts({
          current,
          workspace: nextWorkspace,
        }),
      );
      setSyncMessage(`已同步设计源：${payload.source.name}`);
    } catch (error) {
      setSyncMessage(
        error instanceof Error ? `同步失败：${error.message}` : "同步失败：未知错误",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function dispatchPluginCommands() {
    if (!selectedBridgeSessionId) {
      setBridgeMessage("当前没有在线插件会话可接收命令。");
      return;
    }

    setIsBusy(true);
    try {
      const payload = JSON.parse(pluginCommands) as FigmaPluginCommandBatch;
      const receipt = await fetchJson<RuntimeBridgeDispatchReceipt>("/api/runtime/bridge-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetSessionId: selectedBridgeSessionId,
          source: "workspace",
          payload,
        }),
      });
      setLastBridgeDispatchReceipt(receipt);
      setBridgeMessage(
        `已把 ${receipt.payloadCommandCount} 条命令推送到插件队列：${receipt.command.id}`,
      );
      await loadBridgeOverview(false);
    } catch (error) {
      setBridgeMessage(
        error instanceof Error ? `下发失败：${error.message}` : "下发失败：未知错误",
      );
    } finally {
      setIsBusy(false);
    }
  }

  function composePluginCommands() {
    const result = composePluginCommandsFromPrompt(naturalLanguagePrompt);
    setCommandComposition(result);
    setPluginCommands(JSON.stringify(result.batch, null, 2));
    setBridgeMessage(
      result.warnings.length > 0
        ? `命令已生成，但有 ${result.warnings.length} 条未识别内容。`
        : "已从自然语言生成结构化命令。",
    );
  }

  function updateMappingStatus(
    mappingId: string,
    status: WorkspaceReadModel["mappings"][number]["status"],
  ) {
    void (async () => {
      setIsBusy(true);
      try {
        const receipt = await fetchJson<WorkspaceMappingStatusReceipt>(
          "/api/workspace/mapping-status",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mappingId,
              status,
            }),
          },
        );
        setWorkspaceModel((current) => {
          if (!current) {
            return current;
          }
          return {
            ...current,
            workspace: {
              ...current.workspace,
              updatedAt: receipt.workspaceUpdatedAt,
            },
            mappings: current.mappings.map((mapping) =>
              mapping.id === mappingId ? receipt.mapping : mapping,
            ),
          };
        });
      } finally {
        setIsBusy(false);
      }
    })();
  }

  function updateReviewDraft(
    reviewId: string,
    nextDraft: ReviewQueueDraft,
  ) {
    setReviewDrafts((current) => ({
      ...current,
      [reviewId]: nextDraft,
    }));
  }

  async function updateReviewQueueItem(
    reviewId: string,
    draft: ReviewQueueDraft,
  ) {
    setIsBusy(true);
    try {
      const receipt = await fetchJson<WorkspaceReviewQueueUpdateReceipt>(
        "/api/workspace/review-queue-item",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reviewId,
            status: draft.status,
            owner: draft.owner.trim(),
          }),
        },
      );
      setWorkspaceModel((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          workspace: {
            ...current.workspace,
            updatedAt: receipt.workspaceUpdatedAt,
          },
          reviewQueue: current.reviewQueue.map((review) =>
            review.id === reviewId ? receipt.review : review,
          ),
        };
      });
      setReviewDrafts((current) => {
        const next = { ...current };
        delete next[reviewId];
        return next;
      });
      setReviewMessage(`已更新评审项：${receipt.review.title}`);
    } catch (error) {
      setReviewMessage(
        error instanceof Error ? `评审更新失败：${error.message}` : "评审更新失败：未知错误",
      );
    } finally {
      setIsBusy(false);
    }
  }

  if (!workspaceModel) {
    return (
      <div className="workspace-shell">
        <div className="workspace-loading">正在加载本地工作台数据…</div>
      </div>
    );
  }

  const selectedBridgeSession =
    bridgeOverview?.sessions.find((session) => session.id === selectedBridgeSessionId) ?? null;
  const currentDesignContextRequestKey = buildDesignContextRequestKey({
    selectionIds,
    action: activeAction,
    targetSessionId: String(selectedBridgeSessionId || "").trim(),
    workspaceUpdatedAt: workspaceModel.workspace.updatedAt,
  });
  const isDesignContextStale =
    Boolean(designContext) && designContextRequestKey !== currentDesignContextRequestKey;
  const designContextSessionMatchesSelection =
    designContext?.pluginSelection.targetSessionId === (selectedBridgeSession?.id ?? null);

  return (
    <div className="workspace-shell">
      <header className="workspace-topbar">
        <div>
          <p className="topbar-kicker">Workspace / Shared Data Model</p>
          <h1>{workspaceModel.workspace.name}</h1>
          <p className="topbar-copy">{workspaceModel.workspace.description}</p>
        </div>
        <div className="topbar-actions">
          <StatusPill tone={isBusy ? "amber" : "green"} label={isBusy ? "处理中" : "就绪"} />
          <button className="button-secondary" onClick={resetWorkspace} type="button">
            重置示例数据
          </button>
        </div>
      </header>

      <section className="system-grid">
        <Panel
          title="系统边界"
          description="用两个运行时承载两条链路，避免设计执行器和实现工作台互相污染。"
        >
          <div className="stack-list">
            <article className="data-card">
              <span className="card-kicker">workspace</span>
              <h3>Figma to React</h3>
              <p>同步设计摘要、组件映射、评审队列、Runtime Context Pack 与本地 action。</p>
            </article>
            <article className="data-card">
              <span className="card-kicker">figma-plugin</span>
              <h3>AutoDesign</h3>
              <p>读取当前 selection，执行 fill、paint style、color variable 和 variable binding。</p>
            </article>
          </div>
        </Panel>

        <WorkspaceBridgeCommandPanel
          naturalLanguagePrompt={naturalLanguagePrompt}
          onNaturalLanguagePromptChange={setNaturalLanguagePrompt}
          onComposePluginCommands={composePluginCommands}
          bridgeOverview={bridgeOverview}
          selectedBridgeSessionId={selectedBridgeSessionId}
          onSelectedBridgeSessionIdChange={setSelectedBridgeSessionId}
          pluginCommands={pluginCommands}
          onPluginCommandsChange={setPluginCommands}
          onDispatchPluginCommands={dispatchPluginCommands}
          onRefreshBridgeOverview={() => {
            void loadBridgeOverview(true);
          }}
          bridgeMessage={bridgeMessage}
          commandComposition={commandComposition}
          lastBridgeDispatchReceipt={lastBridgeDispatchReceipt}
        />
      </section>

      <section className="workspace-grid">
        <WorkspaceDataColumns
          isBusy={isBusy}
          onReviewDraftChange={updateReviewDraft}
          onReviewSave={(reviewId, draft) => {
            void updateReviewQueueItem(reviewId, draft);
          }}
          onSubmitSyncPayload={() => {
            void submitSyncPayload();
          }}
          onSyncPayloadChange={setSyncPayload}
          onUpdateMappingStatus={updateMappingStatus}
          reviewDrafts={reviewDrafts}
          reviewMessage={reviewMessage}
          syncMessage={syncMessage}
          syncPayload={syncPayload}
          workspaceModel={workspaceModel}
        />

        <div className="workspace-column">
          <WorkspaceBridgeStatusPanel
            bridgeOverview={bridgeOverview}
            selectedBridgeSession={selectedBridgeSession}
            isDesignContextSynced={
              Boolean(designContext) &&
              !isDesignContextStale &&
              designContextSessionMatchesSelection
            }
          />

          <WorkspaceRuntimePanels
            actionOptions={actionOptions}
            activeAction={activeAction}
            onActiveActionChange={setActiveAction}
            selectionPool={workspaceModel.selection.options.map((item) => ({
              id: item.id,
              label: item.label,
              kind: item.kindLabel,
            }))}
            selectionIds={selectionIds}
            onToggleSelection={toggleSelection}
            onGenerateDesignContext={generateDesignContext}
            onRunAction={runAction}
            canRunAction={Boolean(contextPack) && !isDesignContextStale}
            isDesignContextStale={isDesignContextStale}
            designContext={designContext}
            contextPack={contextPack}
            runtimeOutput={runtimeOutput}
          />
        </div>
      </section>
    </div>
  );
}
