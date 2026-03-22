import { startTransition, useEffect, useState } from "react";

import {
  composePluginCommandsFromPrompt,
  type PluginCommandComposition,
} from "../../../shared/plugin-command-composer";
import type { FigmaPluginCommandBatch } from "../../../shared/plugin-contract";
import type {
  PluginBridgeCommandRecord,
  PluginBridgeSession,
  PluginBridgeSnapshot,
} from "../../../shared/plugin-bridge";
import type {
  ContextPack,
  FigmaSyncPayload,
  ProjectData,
  RuntimeAction,
  RuntimeEnvelope,
} from "../../../shared/types";
import { Panel } from "./panel";
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

export function WorkspaceShell() {
  const [project, setProject] = useState<ProjectData | null>(null);
  const [selectionIds, setSelectionIds] = useState<string[]>([]);
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
  const [bridgeSessions, setBridgeSessions] = useState<PluginBridgeSession[]>([]);
  const [bridgeCommands, setBridgeCommands] = useState<PluginBridgeCommandRecord[]>([]);
  const [selectedBridgeSessionId, setSelectedBridgeSessionId] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [bridgeMessage, setBridgeMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    void loadProject();
    void loadBridgeSnapshot(false);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadBridgeSnapshot(false);
    }, 3000);

    return () => window.clearInterval(timer);
  }, []);

  async function loadProject() {
    setIsBusy(true);
    try {
      const nextProject = await fetchJson<ProjectData>("/api/project");
      setProject(nextProject);
      setSelectionIds((current) => {
        if (current.length > 0) {
          return current;
        }
        return nextProject.runtimeSessions[0]?.selectionIds ?? [];
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function loadBridgeSnapshot(showBusy: boolean) {
    if (showBusy) {
      setIsBusy(true);
    }

    try {
      const snapshot = await fetchJson<PluginBridgeSnapshot>("/api/plugin-bridge");
      setBridgeSessions(snapshot.sessions);
      setBridgeCommands(snapshot.commands);
      setSelectedBridgeSessionId((current) => {
        if (current && snapshot.sessions.some((session) => session.id === current)) {
          return current;
        }
        return snapshot.sessions[0]?.id ?? "";
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

  async function saveProject(nextProject: ProjectData) {
    setIsBusy(true);
    try {
      const saved = await fetchJson<ProjectData>("/api/project", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextProject),
      });
      setProject(saved);
    } finally {
      setIsBusy(false);
    }
  }

  async function resetProject() {
    setIsBusy(true);
    try {
      const reset = await fetchJson<ProjectData>("/api/project/reset", {
        method: "POST",
      });
      setProject(reset);
      setSelectionIds(reset.runtimeSessions[0]?.selectionIds ?? []);
      setContextPack(null);
      setRuntimeOutput(null);
      setSyncMessage("已重置为内置示例数据。");
    } finally {
      setIsBusy(false);
    }
  }

  async function generateContextPack() {
    setIsBusy(true);
    try {
      const graphKind = activeAction.startsWith("knowledge") ? "knowledge" : "codegraph";
      const nextPack = await fetchJson<ContextPack>("/api/runtime/context-pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectionIds,
          graphKind,
          action: activeAction,
        }),
      });
      setContextPack(nextPack);
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
      const nextProject = await fetchJson<ProjectData>("/api/figma/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setProject(nextProject);
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
      const record = await fetchJson<PluginBridgeCommandRecord>("/api/plugin-bridge/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetSessionId: selectedBridgeSessionId,
          source: "workspace",
          payload,
        }),
      });
      setBridgeMessage(`已把命令推送到插件队列：${record.id}`);
      await loadBridgeSnapshot(false);
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
    status: ProjectData["componentMappings"][number]["status"],
  ) {
    if (!project) {
      return;
    }

    startTransition(() => {
      const nextProject: ProjectData = {
        ...project,
        componentMappings: project.componentMappings.map((mapping) =>
          mapping.id === mappingId ? { ...mapping, status } : mapping,
        ),
      };
      setProject(nextProject);
      void saveProject(nextProject);
    });
  }

  if (!project) {
    return (
      <div className="workspace-shell">
        <div className="workspace-loading">正在加载本地工作台数据…</div>
      </div>
    );
  }

  const selectionPool = [
    ...project.designSources.map((item) => ({
      id: item.id,
      label: item.name,
      kind: "Design Source",
    })),
    ...project.designScreens.map((item) => ({
      id: item.id,
      label: item.name,
      kind: "Screen",
    })),
    ...project.componentMappings.map((item) => ({
      id: item.id,
      label: item.designName,
      kind: "Component",
    })),
    ...project.reviewItems.map((item) => ({
      id: item.id,
      label: item.title,
      kind: "Review",
    })),
  ];

  const selectedBridgeSession =
    bridgeSessions.find((session) => session.id === selectedBridgeSessionId) ?? null;

  return (
    <div className="workspace-shell">
      <header className="workspace-topbar">
        <div>
          <p className="topbar-kicker">Workspace / Shared Data Model</p>
          <h1>{project.meta.name}</h1>
          <p className="topbar-copy">{project.meta.description}</p>
        </div>
        <div className="topbar-actions">
          <StatusPill tone={isBusy ? "amber" : "green"} label={isBusy ? "处理中" : "就绪"} />
          <button className="button-secondary" onClick={resetProject} type="button">
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
              <h3>Codex to Figma</h3>
              <p>读取当前 selection，执行 fill、paint style、color variable 和 variable binding。</p>
            </article>
          </div>
        </Panel>

        <Panel
          title="插件命令协议"
          description="工作台现在可以直接把命令推送到在线插件，不再需要手动复制 JSON。"
        >
          <div className="sync-panel">
            <label className="field">
              <span>Natural Language</span>
              <textarea
                className="code-box"
                onChange={(event) => setNaturalLanguagePrompt(event.target.value)}
                spellCheck={false}
                value={naturalLanguagePrompt}
              />
            </label>
            <div className="inline-actions">
              <button className="button-secondary" onClick={composePluginCommands} type="button">
                从自然语言生成命令
              </button>
              <span className="muted-line">
                支持示例：`改成粉色`、`描边蓝色`、`圆角 16`、`透明度 80`、`变量 Brand/pink/500 #FF6FAE 绑定`
              </span>
            </div>
            <label className="field">
              <span>Target Plugin Session</span>
              <select
                className="status-select"
                onChange={(event) => setSelectedBridgeSessionId(event.target.value)}
                value={selectedBridgeSessionId}
              >
                {bridgeSessions.length === 0 ? <option value="">暂无在线插件</option> : null}
                {bridgeSessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.label} · {session.fileName} / {session.pageName} · {session.status}
                  </option>
                ))}
              </select>
            </label>
            <textarea
              className="code-box code-box-short"
              onChange={(event) => setPluginCommands(event.target.value)}
              spellCheck={false}
              value={pluginCommands}
            />
            <div className="inline-actions">
              <button className="button-primary" onClick={dispatchPluginCommands} type="button">
                推送到插件
              </button>
              <button
                className="button-secondary"
                onClick={() => {
                  void loadBridgeSnapshot(true);
                }}
                type="button"
              >
                刷新桥接状态
              </button>
            </div>
            <p className="muted-line">
              {bridgeMessage ||
                "工作台通过本地桥接队列下发命令，插件轮询领取并回传执行结果。"}
            </p>
            {commandComposition ? (
              <div className="token-row">
                {commandComposition.notes.map((note) => (
                  <span className="token token-accent" key={note}>
                    {note}
                  </span>
                ))}
                {commandComposition.warnings.map((warning) => (
                  <span className="token" key={warning}>
                    warning: {warning}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </Panel>
      </section>

      <section className="workspace-grid">
        <div className="workspace-column">
          <Panel title="设计源" description="本地后端保存的 Figma 文件快照。">
            <div className="stack-list">
              {project.designSources.map((source) => (
                <article className="data-card" key={source.id}>
                  <div className="data-card-head">
                    <h3>{source.name}</h3>
                    <StatusPill
                      tone={source.status === "connected" ? "green" : "amber"}
                      label={source.status}
                    />
                  </div>
                  <p>{source.summary}</p>
                  <dl className="mini-meta">
                    <div>
                      <dt>Figma Key</dt>
                      <dd>{source.figmaFileKey}</dd>
                    </div>
                    <div>
                      <dt>Branch</dt>
                      <dd>{source.branch}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </Panel>

          <Panel title="页面与组件映射" description="把设计页面和 React 目标组件放在同一处核对。">
            <div className="stack-list">
              {project.componentMappings.map((mapping) => (
                <article className="data-card" key={mapping.id}>
                  <div className="data-card-head">
                    <div>
                      <h3>{mapping.designName}</h3>
                      <p className="muted-line">{mapping.reactName}</p>
                    </div>
                    <select
                      className="status-select"
                      onChange={(event) =>
                        updateMappingStatus(mapping.id, event.target.value as typeof mapping.status)
                      }
                      value={mapping.status}
                    >
                      <option value="planned">planned</option>
                      <option value="prototype">prototype</option>
                      <option value="verified">verified</option>
                    </select>
                  </div>
                  <p>{mapping.notes}</p>
                  <div className="token-row">
                    {mapping.props.map((item) => (
                      <span className="token" key={`${mapping.id}-${item}`}>
                        prop: {item}
                      </span>
                    ))}
                    {mapping.states.map((item) => (
                      <span className="token token-accent" key={`${mapping.id}-${item}`}>
                        state: {item}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </Panel>
        </div>

        <div className="workspace-column workspace-column-wide">
          <Panel title="评审与联调队列" description="记录设计差异、原型问题和 Runtime 测试待办。">
            <div className="board-grid">
              {project.reviewItems.map((item) => (
                <article className="board-card" key={item.id}>
                  <div className="data-card-head">
                    <StatusPill
                      tone={
                        item.status === "done"
                          ? "green"
                          : item.status === "doing"
                            ? "blue"
                            : "slate"
                      }
                      label={`${item.area} / ${item.status}`}
                    />
                    <span className="owner-tag">{item.owner}</span>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.detail}</p>
                </article>
              ))}
            </div>
          </Panel>

          <Panel title="模拟 Figma MCP 同步" description="后续可直接用 MCP 或其它工具 POST 到这个接口。">
            <div className="sync-panel">
              <textarea
                className="code-box"
                onChange={(event) => setSyncPayload(event.target.value)}
                spellCheck={false}
                value={syncPayload}
              />
              <div className="inline-actions">
                <button className="button-primary" onClick={submitSyncPayload} type="button">
                  同步到后端
                </button>
                <span className="muted-line">{syncMessage || "可直接编辑 JSON 后提交。"}</span>
              </div>
            </div>
          </Panel>
        </div>

        <div className="workspace-column">
          <Panel
            title="插件桥接状态"
            description="这里显示在线插件会话、当前 selection 摘要和最近命令执行结果。"
          >
            <div className="stack-list">
              {selectedBridgeSession ? (
                <article className="data-card">
                  <div className="data-card-head">
                    <div>
                      <h3>{selectedBridgeSession.label}</h3>
                      <p className="muted-line">
                        {selectedBridgeSession.fileName} / {selectedBridgeSession.pageName}
                      </p>
                    </div>
                    <StatusPill
                      tone={selectedBridgeSession.status === "online" ? "green" : "slate"}
                      label={selectedBridgeSession.status}
                    />
                  </div>
                  <div className="token-row">
                    {selectedBridgeSession.selection.length > 0 ? (
                      selectedBridgeSession.selection.map((node) => (
                        <span className="token" key={node.id}>
                          {node.name} · {node.type}
                        </span>
                      ))
                    ) : (
                      <span className="muted-line">插件当前没有选中节点。</span>
                    )}
                  </div>
                </article>
              ) : (
                <article className="data-card">
                  <p>还没有插件连接到本地桥接。先在 Figma 中运行 `Figmatest Command Bridge`。</p>
                </article>
              )}

              {bridgeCommands.slice(0, 5).map((command) => (
                <article className="data-card" key={command.id}>
                  <div className="data-card-head">
                    <div>
                      <h3>{command.id}</h3>
                      <p className="muted-line">{command.targetSessionId}</p>
                    </div>
                    <StatusPill
                      tone={
                        command.status === "succeeded"
                          ? "green"
                          : command.status === "failed"
                            ? "amber"
                            : command.status === "claimed"
                              ? "blue"
                              : "slate"
                      }
                      label={command.status}
                    />
                  </div>
                  <p>{command.resultMessage || "等待插件领取或回传结果。"}</p>
                </article>
              ))}
            </div>
          </Panel>

          <Panel title="Runtime AI 测试台" description="选择对象，生成 Context Pack，再跑本地 action。">
            <div className="runtime-controls">
              <label className="field">
                <span>Action</span>
                <select
                  className="status-select"
                  onChange={(event) => setActiveAction(event.target.value as RuntimeAction)}
                  value={activeAction}
                >
                  {actionOptions.map((action) => (
                    <option key={action} value={action}>
                      {action}
                    </option>
                  ))}
                </select>
              </label>

              <div className="selection-grid">
                {selectionPool.map((item) => (
                  <label className="selection-item" key={item.id}>
                    <input
                      checked={selectionIds.includes(item.id)}
                      onChange={() => toggleSelection(item.id)}
                      type="checkbox"
                    />
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.kind}</small>
                    </span>
                  </label>
                ))}
              </div>

              <div className="inline-actions">
                <button className="button-primary" onClick={generateContextPack} type="button">
                  生成 Context Pack
                </button>
                <button
                  className="button-secondary"
                  disabled={!contextPack}
                  onClick={runAction}
                  type="button"
                >
                  运行 Action
                </button>
              </div>
            </div>
          </Panel>

          <Panel title="Context Pack" description="用于发送给 Runtime AI 的结构化输入。">
            <pre className="code-box code-box-short">
              {contextPack ? JSON.stringify(contextPack, null, 2) : "请先生成 Context Pack"}
            </pre>
          </Panel>

          <Panel title="Action 输出" description="本地模拟的 JSON-only 响应，可替换为真实模型结果。">
            <pre className="code-box code-box-short">
              {runtimeOutput ? JSON.stringify(runtimeOutput, null, 2) : "请先运行 Action"}
            </pre>
          </Panel>
        </div>
      </section>
    </div>
  );
}
