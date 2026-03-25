import assert from "node:assert/strict";
import test from "node:test";

import { seededProject } from "./seed.js";
import {
  buildWorkspaceMappingStatusReceipt,
  buildWorkspaceReadModel,
  buildWorkspaceReviewQueueUpdateReceipt,
} from "./workspace-read-model.js";

test("buildWorkspaceReadModel narrows project data into a workspace-facing read model", () => {
  const readModel = buildWorkspaceReadModel(seededProject);

  assert.equal(readModel.workspace.id, "autodesign-main");
  assert.deepEqual(readModel.selection.defaultIds, [
    "screen-dashboard",
    "mapping-account-tile",
  ]);
  assert.equal(readModel.selection.options.length, 11);
  assert.deepEqual(
    readModel.selection.options.slice(0, 4).map((item) => `${item.kind}:${item.label}`),
    [
      "designSource:Mobile Banking App",
      "designSource:Design System Foundations",
      "screen:Onboarding / Welcome",
      "screen:Dashboard / Account Overview",
    ],
  );
  assert.deepEqual(readModel.designSources[0], {
    id: "source-mobile-banking",
    name: "Mobile Banking App",
    status: "connected",
    summary: "主文件包含 onboarding、dashboard 与 transfer 流程，适合做状态映射测试。",
    figmaFileKey: "FigmaKey-Banking-App",
    branch: "main",
    lastSyncedAt: "2026-03-22T00:00:00.000Z",
    screenCount: 2,
    mappingCount: 3,
  });
  assert.deepEqual(readModel.screens[0], {
    id: "screen-onboarding",
    name: "Onboarding / Welcome",
    sourceName: "Mobile Banking App",
    purpose: "验证欢迎页的层级、引导卡片与 CTA 状态。",
    summary: "首屏强调信息密度控制和 CTA 对齐，是连调入口页。",
    stateNotes: ["default", "loading", "error-inline"],
    mappingNames: ["Welcome Hero Card", "Button / Primary"],
    reviewTitles: ["欢迎页文案层级是否与实现组件树一致"],
  });
  assert.deepEqual(readModel.mappings[2]?.screenNames, [
    "Buttons / States",
    "Onboarding / Welcome",
  ]);
  assert.deepEqual(readModel.reviewQueue[0]?.relatedLabels, [
    "Onboarding / Welcome",
    "Welcome Hero Card",
  ]);
  assert.equal((readModel as Record<string, unknown>).runtimeSessions, undefined);
  assert.equal((readModel as Record<string, unknown>).componentMappings, undefined);
  assert.equal((readModel as Record<string, unknown>).reviewItems, undefined);
});

test("buildWorkspaceMappingStatusReceipt reuses the narrowed mapping card contract", () => {
  const receipt = buildWorkspaceMappingStatusReceipt({
    project: seededProject,
    mapping: seededProject.componentMappings[1]!,
  });

  assert.equal(receipt.mapping.id, "mapping-account-tile");
  assert.equal(receipt.mapping.status, "planned");
  assert.deepEqual(receipt.mapping.screenNames, ["Dashboard / Account Overview"]);
  assert.equal(receipt.workspaceUpdatedAt, seededProject.meta.updatedAt);
});

test("buildWorkspaceReviewQueueUpdateReceipt reuses the narrowed review card contract", () => {
  const receipt = buildWorkspaceReviewQueueUpdateReceipt({
    project: seededProject,
    review: seededProject.reviewItems[0]!,
  });

  assert.equal(receipt.review.id, "review-copy-tone");
  assert.equal(receipt.review.status, "doing");
  assert.equal(receipt.review.owner, "Product + Frontend");
  assert.deepEqual(receipt.review.relatedLabels, [
    "Onboarding / Welcome",
    "Welcome Hero Card",
  ]);
  assert.equal(receipt.workspaceUpdatedAt, seededProject.meta.updatedAt);
});
