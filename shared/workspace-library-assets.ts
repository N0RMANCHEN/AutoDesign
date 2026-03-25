import type {
  LibraryAssetKind,
  ProjectData,
} from "./types.js";

export type WorkspaceLibraryAssetCard = {
  id: string;
  name: string;
  kind: LibraryAssetKind;
  sourceId: string;
  sourceName: string;
  summary: string;
  keywords: string[];
  screenNames: string[];
  mappingNames: string[];
  reviewTitles: string[];
};

export type WorkspaceLibraryAssetSearchRequest = {
  query?: string;
  kind?: LibraryAssetKind;
  sourceId?: string;
  limit?: number;
};

export type WorkspaceLibraryAssetSearchResponse = {
  query: string;
  kind: LibraryAssetKind | null;
  sourceId: string | null;
  total: number;
  results: WorkspaceLibraryAssetCard[];
};

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

export function buildWorkspaceLibraryAssetCard(params: {
  project: ProjectData;
  asset: ProjectData["libraryAssets"][number];
}): WorkspaceLibraryAssetCard {
  const { asset, project } = params;
  const sourceName =
    project.designSources.find((item) => item.id === asset.sourceId)?.name ?? asset.sourceId;
  const screenLookup = new Map(project.designScreens.map((screen) => [screen.id, screen.name]));
  const mappingLookup = new Map(project.componentMappings.map((mapping) => [mapping.id, mapping.designName]));
  const reviewTitles = uniqueStrings(
    project.reviewItems
      .filter(
        (review) =>
          review.relatedIds.includes(asset.id) ||
          review.relatedIds.some((relatedId) => asset.screenIds.includes(relatedId)) ||
          review.relatedIds.some((relatedId) => asset.mappingIds.includes(relatedId)),
      )
      .map((review) => review.title),
  );

  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    sourceId: asset.sourceId,
    sourceName,
    summary: asset.summary,
    keywords: uniqueStrings(asset.keywords),
    screenNames: uniqueStrings(asset.screenIds.map((screenId) => screenLookup.get(screenId) ?? screenId)),
    mappingNames: uniqueStrings(asset.mappingIds.map((mappingId) => mappingLookup.get(mappingId) ?? mappingId)),
    reviewTitles,
  };
}

export function buildWorkspaceLibraryAssetCards(project: ProjectData): WorkspaceLibraryAssetCard[] {
  return project.libraryAssets.map((asset) => buildWorkspaceLibraryAssetCard({ project, asset }));
}

function normalizeSearchTokens(query: string) {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function buildSearchText(asset: WorkspaceLibraryAssetCard) {
  return [
    asset.name,
    asset.kind,
    asset.sourceName,
    asset.summary,
    ...asset.keywords,
    ...asset.screenNames,
    ...asset.mappingNames,
    ...asset.reviewTitles,
  ]
    .join(" ")
    .toLowerCase();
}

export function filterWorkspaceLibraryAssetCards(params: {
  assets: WorkspaceLibraryAssetCard[];
  query?: string;
  kind?: LibraryAssetKind;
  sourceId?: string;
  limit?: number;
}): WorkspaceLibraryAssetCard[] {
  const tokens = normalizeSearchTokens(String(params.query || ""));
  const limit =
    Number.isFinite(params.limit) && Number(params.limit) > 0
      ? Math.min(Math.trunc(Number(params.limit)), 50)
      : null;

  const filtered = params.assets.filter((asset) => {
    if (params.kind && asset.kind !== params.kind) {
      return false;
    }

    if (params.sourceId && asset.sourceId !== params.sourceId) {
      return false;
    }

    if (tokens.length === 0) {
      return true;
    }

    const searchText = buildSearchText(asset);
    return tokens.every((token) => searchText.includes(token));
  });

  return limit === null ? filtered : filtered.slice(0, limit);
}

export function buildWorkspaceLibraryAssetSearchResponse(
  params: {
    project: ProjectData;
  } & WorkspaceLibraryAssetSearchRequest,
): WorkspaceLibraryAssetSearchResponse {
  const query = String(params.query || "").trim();
  const cards = buildWorkspaceLibraryAssetCards(params.project);
  const results = filterWorkspaceLibraryAssetCards({
    assets: cards,
    query,
    kind: params.kind,
    sourceId: params.sourceId,
    limit: params.limit,
  });

  return {
    query,
    kind: params.kind ?? null,
    sourceId: params.sourceId ?? null,
    total: results.length,
    results,
  };
}
