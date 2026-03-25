import type { PluginCommandComposition } from "../../../shared/plugin-command-composer";
import type { RuntimeBridgeDispatchReceipt } from "../../../shared/runtime-bridge-dispatch";
import type {
  RuntimeBridgeOverview,
  RuntimeBridgeOverviewCommand,
  RuntimeBridgeOverviewSession,
} from "../../../shared/runtime-bridge-overview";
import { Panel } from "./panel";
import { StatusPill } from "./status-pill";

function commandTone(command: RuntimeBridgeOverviewCommand) {
  if (command.status === "succeeded") {
    return "green" as const;
  }
  if (command.status === "failed") {
    return "amber" as const;
  }
  if (command.status === "claimed") {
    return "blue" as const;
  }
  return "slate" as const;
}

type BridgeCommandPanelProps = {
  naturalLanguagePrompt: string;
  onNaturalLanguagePromptChange: (value: string) => void;
  onComposePluginCommands: () => void;
  bridgeOverview: RuntimeBridgeOverview | null;
  selectedBridgeSessionId: string;
  onSelectedBridgeSessionIdChange: (value: string) => void;
  pluginCommands: string;
  onPluginCommandsChange: (value: string) => void;
  onDispatchPluginCommands: () => void;
  onRefreshBridgeOverview: () => void;
  bridgeMessage: string;
  commandComposition: PluginCommandComposition | null;
  lastBridgeDispatchReceipt: RuntimeBridgeDispatchReceipt | null;
};

type BridgeStatusPanelProps = {
  bridgeOverview: RuntimeBridgeOverview | null;
  selectedBridgeSession: RuntimeBridgeOverviewSession | null;
  isDesignContextSynced: boolean;
};

export function WorkspaceBridgeCommandPanel(props: BridgeCommandPanelProps) {
  const {
    naturalLanguagePrompt,
    onNaturalLanguagePromptChange,
    onComposePluginCommands,
    bridgeOverview,
    selectedBridgeSessionId,
    onSelectedBridgeSessionIdChange,
    pluginCommands,
    onPluginCommandsChange,
    onDispatchPluginCommands,
    onRefreshBridgeOverview,
    bridgeMessage,
    commandComposition,
    lastBridgeDispatchReceipt,
  } = props;

  return (
    <Panel
      title="插件命令协议"
      description="工作台通过 runtime write surface 下发命令，避免直接消费原始 bridge command record。"
    >
      <div className="sync-panel">
        <label className="field">
          <span>Natural Language</span>
          <textarea
            className="code-box"
            onChange={(event) => onNaturalLanguagePromptChange(event.target.value)}
            spellCheck={false}
            value={naturalLanguagePrompt}
          />
        </label>
        <div className="inline-actions">
          <button className="button-secondary" onClick={onComposePluginCommands} type="button">
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
            onChange={(event) => onSelectedBridgeSessionIdChange(event.target.value)}
            value={selectedBridgeSessionId}
          >
            {bridgeOverview?.sessions.length ? null : <option value="">暂无在线插件</option>}
            {bridgeOverview?.sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.label} · {session.fileName} / {session.pageName} · {session.status}
              </option>
            ))}
          </select>
        </label>
        <textarea
          className="code-box code-box-short"
          onChange={(event) => onPluginCommandsChange(event.target.value)}
          spellCheck={false}
          value={pluginCommands}
        />
        <div className="inline-actions">
          <button className="button-primary" onClick={onDispatchPluginCommands} type="button">
            推送到插件
          </button>
          <button className="button-secondary" onClick={onRefreshBridgeOverview} type="button">
            刷新桥接状态
          </button>
        </div>
        <p className="muted-line">
          {bridgeMessage ||
            "工作台通过本地桥接队列下发命令，插件轮询领取并回传执行结果。"}
        </p>
        {lastBridgeDispatchReceipt ? (
          <div className="token-row">
            <span className="token token-accent">
              last dispatch: {lastBridgeDispatchReceipt.command.id}
            </span>
            <span className="token">
              queued commands: {lastBridgeDispatchReceipt.payloadCommandCount}
            </span>
            <span className="token">
              target session: {lastBridgeDispatchReceipt.command.targetSessionId}
            </span>
          </div>
        ) : null}
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
  );
}

export function WorkspaceBridgeStatusPanel(props: BridgeStatusPanelProps) {
  const {
    bridgeOverview,
    selectedBridgeSession,
    isDesignContextSynced,
  } = props;

  return (
    <Panel
      title="插件桥接状态"
      description="这里显示聚合后的桥接真相；selection dependency truth 由 Design Context 负责。"
    >
      <div className="stack-list">
        {bridgeOverview ? (
          <article className="data-card">
            <div className="data-card-head">
              <div>
                <h3>Bridge Overview</h3>
                <p className="muted-line">
                  sessions: {bridgeOverview.onlineSessionCount}/{bridgeOverview.sessionCount} online
                </p>
              </div>
              <StatusPill
                tone={bridgeOverview.onlineSessionCount > 0 ? "green" : "slate"}
                label={bridgeOverview.onlineSessionCount > 0 ? "sessions online" : "no session"}
              />
            </div>
            <div className="token-row">
              <span className="token">queued: {bridgeOverview.commandCounts.queued}</span>
              <span className="token">claimed: {bridgeOverview.commandCounts.claimed}</span>
              <span className="token token-accent">
                succeeded: {bridgeOverview.commandCounts.succeeded}
              </span>
              <span className="token">failed: {bridgeOverview.commandCounts.failed}</span>
              {bridgeOverview.staleSessionCount > 0 ? (
                <span className="token">stale sessions: {bridgeOverview.staleSessionCount}</span>
              ) : null}
            </div>
          </article>
        ) : null}

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
            <p className="muted-line">
              cached selection: {selectedBridgeSession.selectionCount} nodes · capabilities: {selectedBridgeSession.capabilityCount}
            </p>
            <div className="inline-actions">
              <StatusPill
                tone={isDesignContextSynced ? "green" : "amber"}
                label={
                  isDesignContextSynced
                    ? "design-context synced"
                    : "design-context needs refresh"
                }
              />
            </div>
            <div className="token-row">
              {selectedBridgeSession.supportsExplicitNodeTargeting ? (
                <span className="token token-accent">explicit node targeting</span>
              ) : null}
              {selectedBridgeSession.hasStyleSnapshot ? (
                <span className="token">style snapshot</span>
              ) : null}
              {selectedBridgeSession.hasVariableSnapshot ? (
                <span className="token">variable snapshot</span>
              ) : null}
            </div>
          </article>
        ) : (
          <article className="data-card">
            <p>还没有插件连接到本地桥接。先在 Figma 中运行 `AutoDesign`。</p>
          </article>
        )}

        {(bridgeOverview?.commands ?? []).slice(0, 5).map((command) => (
          <article className="data-card" key={command.id}>
            <div className="data-card-head">
              <div>
                <h3>{command.id}</h3>
                <p className="muted-line">{command.targetSessionId}</p>
              </div>
              <StatusPill tone={commandTone(command)} label={command.status} />
            </div>
            <p>{command.resultMessage || "等待插件领取或回传结果。"}</p>
            <div className="token-row">
              {command.warningCount > 0 ? (
                <span className="token">warnings: {command.warningCount}</span>
              ) : null}
              {command.errorCount > 0 ? (
                <span className="token">errors: {command.errorCount}</span>
              ) : null}
              {command.changedNodeCount > 0 ? (
                <span className="token token-accent">
                  changed: {command.changedNodeCount}
                </span>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </Panel>
  );
}
