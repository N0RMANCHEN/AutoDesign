import assert from "node:assert/strict";
import test from "node:test";

import { seededProject } from "./seed.js";
import {
  buildWorkspaceLibraryAssetCards,
  buildWorkspaceLibraryAssetSearchResponse,
  filterWorkspaceLibraryAssetCards,
} from "./workspace-library-assets.js";

test("buildWorkspaceLibraryAssetCards narrows library assets into workspace-facing cards", () => {
  const cards = buildWorkspaceLibraryAssetCards(seededProject);

  assert.deepEqual(cards[2], {
    id: "asset-primary-button-library",
    name: "Primary Button Library",
    kind: "component",
    sourceId: "source-design-system",
    sourceName: "Design System Foundations",
    summary: "按钮组件的主状态资产，包含 leading icon、loading 和 disabled 变体。",
    keywords: ["buttons", "states", "primary", "design-system"],
    screenNames: ["Buttons / States", "Onboarding / Welcome"],
    mappingNames: ["Button / Primary"],
    reviewTitles: [
      "欢迎页文案层级是否与实现组件树一致",
      "Runtime Context Pack 是否覆盖设计来源和组件状态",
    ],
  });
});

test("filterWorkspaceLibraryAssetCards matches query tokens and source filters over narrowed cards", () => {
  const cards = buildWorkspaceLibraryAssetCards(seededProject);

  assert.deepEqual(
    filterWorkspaceLibraryAssetCards({
      assets: cards,
      query: "button loading",
    }).map((asset) => asset.id),
    ["asset-primary-button-library"],
  );
  assert.deepEqual(
    filterWorkspaceLibraryAssetCards({
      assets: cards,
      sourceId: "source-mobile-banking",
      limit: 1,
    }).map((asset) => asset.id),
    ["asset-welcome-hero-illustration"],
  );
});

test("buildWorkspaceLibraryAssetSearchResponse reuses the narrowed asset search contract", () => {
  const response = buildWorkspaceLibraryAssetSearchResponse({
    project: seededProject,
    query: "dashboard icons",
    kind: "icon",
  });

  assert.equal(response.query, "dashboard icons");
  assert.equal(response.kind, "icon");
  assert.equal(response.sourceId, null);
  assert.equal(response.total, 1);
  assert.deepEqual(response.results.map((asset) => asset.id), [
    "asset-account-quick-action-icons",
  ]);
  assert.equal((response.results[0] as Record<string, unknown>).screenIds, undefined);
  assert.equal((response.results[0] as Record<string, unknown>).mappingIds, undefined);
});
