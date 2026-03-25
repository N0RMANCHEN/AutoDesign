import type { WorkspaceReadModel } from "../../../shared/workspace-read-model";
import { Panel } from "./panel";
import { StatusPill } from "./status-pill";

export type ReviewQueueDraft = {
  status: WorkspaceReadModel["reviewQueue"][number]["status"];
  owner: string;
};

function buildReviewQueueDraft(
  review: WorkspaceReadModel["reviewQueue"][number],
): ReviewQueueDraft {
  return {
    status: review.status,
    owner: review.owner,
  };
}

function isReviewQueueDraftDirty(params: {
  draft: ReviewQueueDraft;
  review: WorkspaceReadModel["reviewQueue"][number];
}) {
  return (
    params.draft.status !== params.review.status ||
    params.draft.owner.trim() !== params.review.owner
  );
}

export function WorkspaceDataColumns(props: {
  workspaceModel: WorkspaceReadModel;
  isBusy: boolean;
  onUpdateMappingStatus: (
    mappingId: string,
    status: WorkspaceReadModel["mappings"][number]["status"],
  ) => void;
  reviewMessage: string;
  reviewDrafts: Record<string, ReviewQueueDraft>;
  onReviewDraftChange: (reviewId: string, draft: ReviewQueueDraft) => void;
  onReviewSave: (reviewId: string, draft: ReviewQueueDraft) => void;
  syncPayload: string;
  onSyncPayloadChange: (value: string) => void;
  onSubmitSyncPayload: () => void;
  syncMessage: string;
}) {
  const {
    isBusy,
    onReviewDraftChange,
    onReviewSave,
    onSubmitSyncPayload,
    onSyncPayloadChange,
    onUpdateMappingStatus,
    reviewDrafts,
    reviewMessage,
    syncMessage,
    syncPayload,
    workspaceModel,
  } = props;

  return (
    <>
      <div className="workspace-column">
        <Panel title="设计源" description="本地后端保存的 Figma 文件快照。">
          <div className="stack-list">
            {workspaceModel.designSources.map((source) => (
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
                <div className="token-row">
                  <span className="token">screens: {source.screenCount}</span>
                  <span className="token token-accent">mappings: {source.mappingCount}</span>
                </div>
              </article>
            ))}
          </div>
        </Panel>

        <Panel title="页面与组件映射" description="把设计页面和 React 目标组件放在同一处核对。">
          <div className="stack-list">
            {workspaceModel.mappings.map((mapping) => (
              <article className="data-card" key={mapping.id}>
                <div className="data-card-head">
                  <div>
                    <h3>{mapping.designName}</h3>
                    <p className="muted-line">{mapping.reactName}</p>
                  </div>
                  <select
                    className="status-select"
                    onChange={(event) =>
                      onUpdateMappingStatus(
                        mapping.id,
                        event.target.value as typeof mapping.status,
                      )
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
                  {mapping.screenNames.map((screenName) => (
                    <span className="token" key={`${mapping.id}-${screenName}`}>
                      screen: {screenName}
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
          <p className="muted-line">
            {reviewMessage || "评审队列通过 workspace write surface 更新 status / owner。"}
          </p>
          <div className="board-grid">
            {workspaceModel.reviewQueue.map((item) => {
              const draft = reviewDrafts[item.id] ?? buildReviewQueueDraft(item);
              const canSave =
                isReviewQueueDraftDirty({ draft, review: item }) &&
                draft.owner.trim().length > 0;
              return (
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
                  <div className="review-edit-grid">
                    <label className="field">
                      <span>Status</span>
                      <select
                        className="status-select"
                        onChange={(event) =>
                          onReviewDraftChange(item.id, {
                            ...draft,
                            status: event.target.value as typeof draft.status,
                          })
                        }
                        value={draft.status}
                      >
                        <option value="todo">todo</option>
                        <option value="doing">doing</option>
                        <option value="done">done</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Owner</span>
                      <input
                        className="status-select"
                        onChange={(event) =>
                          onReviewDraftChange(item.id, {
                            ...draft,
                            owner: event.target.value,
                          })
                        }
                        type="text"
                        value={draft.owner}
                      />
                    </label>
                  </div>
                  <div className="inline-actions">
                    <button
                      className="button-secondary"
                      disabled={!canSave || isBusy}
                      onClick={() => onReviewSave(item.id, draft)}
                      type="button"
                    >
                      保存评审
                    </button>
                  </div>
                  {item.relatedLabels.length > 0 ? (
                    <div className="token-row">
                      {item.relatedLabels.map((label) => (
                        <span className="token" key={`${item.id}-${label}`}>
                          {label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </Panel>

        <Panel title="模拟 Figma MCP 同步" description="后续可直接用 MCP 或其它工具 POST 到这个接口。">
          <div className="sync-panel">
            <textarea
              className="code-box"
              onChange={(event) => onSyncPayloadChange(event.target.value)}
              spellCheck={false}
              value={syncPayload}
            />
            <div className="inline-actions">
              <button className="button-primary" onClick={onSubmitSyncPayload} type="button">
                同步到后端
              </button>
              <span className="muted-line">{syncMessage || "可直接编辑 JSON 后提交。"}</span>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
