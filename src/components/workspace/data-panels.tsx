import { useEffect, useState } from "react";

import type { WorkspaceLibraryAssetSearchResponse } from "../../../shared/workspace-library-assets";
import { filterWorkspaceLibraryAssetCards } from "../../../shared/workspace-library-assets";
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
  const [assetQuery, setAssetQuery] = useState("");
  const [visibleLibraryAssets, setVisibleLibraryAssets] = useState(
    workspaceModel.libraryAssets,
  );
  const [assetSearchMessage, setAssetSearchMessage] = useState("");
  const [isAssetSearchBusy, setIsAssetSearchBusy] = useState(false);

  useEffect(() => {
    const query = assetQuery.trim();

    if (!query) {
      setVisibleLibraryAssets(workspaceModel.libraryAssets);
      setAssetSearchMessage("");
      setIsAssetSearchBusy(false);
      return;
    }

    let cancelled = false;
    setIsAssetSearchBusy(true);
    setAssetSearchMessage("");

    void (async () => {
      try {
        const response = await fetch("/api/workspace/library-assets/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });
        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`);
        }
        const payload = (await response.json()) as WorkspaceLibraryAssetSearchResponse;
        if (cancelled) {
          return;
        }
        setVisibleLibraryAssets(payload.results);
        setAssetSearchMessage(`服务端命中 ${payload.total} 个资产。`);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setVisibleLibraryAssets(
          filterWorkspaceLibraryAssetCards({
            assets: workspaceModel.libraryAssets,
            query,
          }),
        );
        setAssetSearchMessage(
          error instanceof Error
            ? `资产搜索回退到本地 narrowed cards：${error.message}`
            : "资产搜索回退到本地 narrowed cards。",
        );
      } finally {
        if (!cancelled) {
          setIsAssetSearchBusy(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [assetQuery, workspaceModel.libraryAssets]);

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

        <Panel title="设计页面" description="按 screen catalog 查看设计页面、关联映射与评审入口。">
          <div className="stack-list">
            {workspaceModel.screens.map((screen) => (
              <article className="data-card" key={screen.id}>
                <div className="data-card-head">
                  <div>
                    <h3>{screen.name}</h3>
                    <p className="muted-line">{screen.sourceName}</p>
                  </div>
                  <span className="owner-tag">{screen.id}</span>
                </div>
                <p>{screen.summary}</p>
                <div className="token-row">
                  <span className="token token-accent">purpose: {screen.purpose}</span>
                  {screen.stateNotes.map((state) => (
                    <span className="token" key={`${screen.id}-state-${state}`}>
                      state: {state}
                    </span>
                  ))}
                  {screen.mappingNames.map((mappingName) => (
                    <span className="token" key={`${screen.id}-mapping-${mappingName}`}>
                      mapping: {mappingName}
                    </span>
                  ))}
                  {screen.reviewTitles.map((reviewTitle) => (
                    <span className="token" key={`${screen.id}-review-${reviewTitle}`}>
                      review: {reviewTitle}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </Panel>

        <Panel title="资产库" description="按 narrowed asset catalog 查看组件、图标和插图资产。">
          <div className="stack-list">
            <label className="field" htmlFor="workspace-library-asset-search">
              <span>Search Assets</span>
              <input
                className="status-select"
                id="workspace-library-asset-search"
                onChange={(event) => setAssetQuery(event.target.value)}
                placeholder="搜索名称、关键字、screen 或 mapping"
                type="text"
                value={assetQuery}
              />
            </label>
            <p className="muted-line">
              {assetQuery.trim()
                ? assetSearchMessage ||
                  (isAssetSearchBusy
                    ? "正在从 workspace surface 搜索资产…"
                    : `匹配 ${visibleLibraryAssets.length} / ${workspaceModel.libraryAssets.length} 个资产。`)
                : `当前资产目录共 ${workspaceModel.libraryAssets.length} 项。`}
            </p>
            {visibleLibraryAssets.length > 0 ? (
              <div className="stack-list">
                {visibleLibraryAssets.map((asset) => (
                  <article className="data-card" key={asset.id}>
                    <div className="data-card-head">
                      <div>
                        <h3>{asset.name}</h3>
                        <p className="muted-line">{asset.sourceName}</p>
                      </div>
                      <span className="owner-tag">{asset.kind}</span>
                    </div>
                    <p>{asset.summary}</p>
                    <div className="token-row">
                      {asset.keywords.map((keyword) => (
                        <span className="token" key={`${asset.id}-keyword-${keyword}`}>
                          keyword: {keyword}
                        </span>
                      ))}
                      {asset.screenNames.map((screenName) => (
                        <span className="token token-accent" key={`${asset.id}-screen-${screenName}`}>
                          screen: {screenName}
                        </span>
                      ))}
                      {asset.mappingNames.map((mappingName) => (
                        <span className="token" key={`${asset.id}-mapping-${mappingName}`}>
                          mapping: {mappingName}
                        </span>
                      ))}
                      {asset.reviewTitles.map((reviewTitle) => (
                        <span className="token" key={`${asset.id}-review-${reviewTitle}`}>
                          review: {reviewTitle}
                        </span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="data-card">
                <p className="muted-line">当前筛选没有命中任何资产。</p>
              </div>
            )}
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
