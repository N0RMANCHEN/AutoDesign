import type { RuntimeDesignContext } from "../../../shared/runtime-design-context";
import type {
  ContextPack,
  RuntimeAction,
  RuntimeEnvelope,
} from "../../../shared/types";
import { Panel } from "./panel";
import { StatusPill } from "./status-pill";

type SelectionPoolItem = {
  id: string;
  label: string;
  kind: string;
};

export function WorkspaceRuntimePanels(props: {
  actionOptions: RuntimeAction[];
  activeAction: RuntimeAction;
  onActiveActionChange: (nextAction: RuntimeAction) => void;
  selectionPool: SelectionPoolItem[];
  selectionIds: string[];
  onToggleSelection: (id: string) => void;
  onGenerateDesignContext: () => void;
  onRunAction: () => void;
  canRunAction: boolean;
  isDesignContextStale: boolean;
  designContext: RuntimeDesignContext | null;
  contextPack: ContextPack | null;
  runtimeOutput: RuntimeEnvelope | null;
}) {
  const {
    actionOptions,
    activeAction,
    onActiveActionChange,
    selectionPool,
    selectionIds,
    onToggleSelection,
    onGenerateDesignContext,
    onRunAction,
    canRunAction,
    isDesignContextStale,
    designContext,
    contextPack,
    runtimeOutput,
  } = props;

  return (
    <>
      <Panel title="Runtime AI 测试台" description="选择对象，先生成 Design Context，再用其中的 Context Pack 跑本地 action。">
        <div className="runtime-controls">
          <label className="field">
            <span>Action</span>
            <select
              className="status-select"
              onChange={(event) => onActiveActionChange(event.target.value as RuntimeAction)}
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
                  onChange={() => onToggleSelection(item.id)}
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
            <button className="button-primary" onClick={onGenerateDesignContext} type="button">
              生成 Design Context
            </button>
            <button
              className="button-secondary"
              disabled={!canRunAction}
              onClick={onRunAction}
              type="button"
            >
              运行 Action
            </button>
          </div>
          {isDesignContextStale ? (
            <p className="muted-line">
              当前 selection、action 或 session 已变化；请先重新生成 Design Context，再运行 Action。
            </p>
          ) : null}
        </div>
      </Panel>

      <Panel title="Design Context" description="Workspace 优先消费这个本地读层 contract，而不是直接拼 bridge session。">
        {designContext ? (
          <div className="stack-list">
            <article className="data-card">
              <div className="data-card-head">
                <div>
                  <h3>Plugin Selection Truth</h3>
                  <p className="muted-line">
                    {designContext.pluginSelection.note || "using cached plugin selection summary"}
                  </p>
                </div>
                <StatusPill
                  tone={
                    isDesignContextStale
                      ? "amber"
                      : designContext.pluginSelection.available
                        ? "green"
                        : "slate"
                  }
                  label={
                    isDesignContextStale
                      ? "stale"
                      : designContext.pluginSelection.available
                        ? "available"
                        : "gap"
                  }
                />
              </div>
              {isDesignContextStale ? (
                <p className="muted-line">
                  当前展示的是旧的 Design Context 快照；请重新生成以对齐最新 selection、action 和 session。
                </p>
              ) : null}
              <div className="token-row">
                {designContext.pluginSelection.selectionNodeIds.length > 0 ? (
                  designContext.pluginSelection.selection.map((node) => (
                    <span className="token" key={node.id}>
                      {node.name} · {node.type}
                    </span>
                  ))
                ) : (
                  <span className="muted-line">当前没有 plugin selection dependency truth。</span>
                )}
              </div>
              <div className="token-row">
                {designContext.pluginSelection.dependencies.resolvedStyles.map((style) => (
                  <span className="token token-accent" key={style.id}>
                    style: {style.name}
                  </span>
                ))}
                {designContext.pluginSelection.dependencies.resolvedVariables.map((variable) => (
                  <span className="token" key={variable.id}>
                    variable: {variable.collectionName}/{variable.name}
                  </span>
                ))}
                {designContext.pluginSelection.dependencies.unresolvedStyleIds.map((styleId) => (
                  <span className="token" key={styleId}>
                    missing-style: {styleId}
                  </span>
                ))}
                {designContext.pluginSelection.dependencies.unresolvedVariableIds.map((variableId) => (
                  <span className="token" key={variableId}>
                    missing-variable: {variableId}
                  </span>
                ))}
              </div>
            </article>
            <pre className="code-box code-box-short">
              {JSON.stringify(designContext, null, 2)}
            </pre>
          </div>
        ) : (
          <pre className="code-box code-box-short">请先生成 Design Context</pre>
        )}
      </Panel>

      <Panel title="Context Pack" description="用于发送给 Runtime AI 的结构化输入。">
        <pre className="code-box code-box-short">
          {contextPack ? JSON.stringify(contextPack, null, 2) : "请先生成 Design Context"}
        </pre>
      </Panel>

      <Panel title="Action 输出" description="本地模拟的 JSON-only 响应，可替换为真实模型结果。">
        <pre className="code-box code-box-short">
          {runtimeOutput ? JSON.stringify(runtimeOutput, null, 2) : "请先运行 Action"}
        </pre>
      </Panel>
    </>
  );
}
