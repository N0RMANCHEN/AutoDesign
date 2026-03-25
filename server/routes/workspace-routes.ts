import type { IncomingMessage, ServerResponse } from "node:http";

import {
  libraryAssetKinds,
  type FigmaSyncPayload,
  type LibraryAssetKind,
  type MappingStatus,
  type ProjectData,
  type ReviewStatus,
} from "../../shared/types.js";
import { nowIso, slugify } from "../../shared/utils.js";
import { buildWorkspaceLibraryAssetSearchResponse } from "../../shared/workspace-library-assets.js";
import {
  buildWorkspaceMappingStatusReceipt,
  buildWorkspaceReadModel,
  buildWorkspaceReviewQueueUpdateReceipt,
} from "../../shared/workspace-read-model.js";
import { readBody, sendJson } from "../http-utils.js";
import { readProject, resetProject, writeProject } from "../storage.js";
import type { RequestContext } from "./request-context.js";

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function applyFigmaSyncPayload(params: {
  project: ProjectData;
  payload: FigmaSyncPayload;
}): ProjectData {
  const { payload, project } = params;
  const sourceId = `source-${slugify(payload.source.name)}`;
  const syncedAt = nowIso();

  const nextSources = project.designSources.filter((item) => item.id !== sourceId);
  nextSources.unshift({
    id: sourceId,
    name: payload.source.name,
    figmaFileKey: payload.source.figmaFileKey,
    branch: payload.source.branch,
    status: "connected",
    lastSyncedAt: syncedAt,
    summary: payload.source.summary,
  });

  const nextScreens = project.designScreens.filter((screen) => screen.sourceId !== sourceId);
  const nextMappings = [...project.componentMappings];

  payload.screens.forEach((screen) => {
    nextScreens.push({
      id: `screen-${slugify(screen.name)}`,
      sourceId,
      name: screen.name,
      purpose: screen.purpose,
      stateNotes: screen.stateNotes,
      summary: screen.summary,
    });
  });

  payload.components.forEach((component) => {
    const mappingId = `mapping-${slugify(component.designName)}`;
    const existing = nextMappings.find((item) => item.id === mappingId);

    if (existing) {
      existing.designName = component.designName;
      existing.reactName = component.reactName;
      existing.props = component.props;
      existing.states = component.states;
      existing.notes = component.notes;
      existing.status = "prototype";
    } else {
      nextMappings.push({
        id: mappingId,
        designName: component.designName,
        reactName: component.reactName,
        props: component.props,
        states: component.states,
        notes: component.notes,
        status: "prototype",
        screenIds: [],
      });
    }
  });

  const nextLibraryAssets =
    Array.isArray(payload.assets)
      ? payload.assets.map((asset) => {
          const screenIds = uniqueStrings(
            asset.screenNames.map((screenName) => `screen-${slugify(screenName)}`),
          ).filter((screenId) =>
            nextScreens.some((screen) => screen.id === screenId && screen.sourceId === sourceId),
          );
          const mappingIds = uniqueStrings(
            asset.mappingDesignNames.map((mappingName) => `mapping-${slugify(mappingName)}`),
          ).filter((mappingId) =>
            nextMappings.some((mapping) => mapping.id === mappingId),
          );

          return {
            id: `asset-${slugify(asset.name)}`,
            sourceId,
            name: asset.name,
            kind: asset.kind,
            summary: asset.summary,
            keywords: uniqueStrings(asset.keywords),
            screenIds,
            mappingIds,
          };
        })
      : project.libraryAssets.filter((asset) => asset.sourceId === sourceId);

  return {
    ...project,
    designSources: nextSources,
    designScreens: nextScreens,
    componentMappings: nextMappings,
    libraryAssets: [
      ...project.libraryAssets.filter((asset) => asset.sourceId !== sourceId),
      ...nextLibraryAssets,
    ],
  };
}

async function handleWorkspaceReadModel(response: ServerResponse) {
  const project = await readProject();
  sendJson(response, 200, buildWorkspaceReadModel(project));
}

async function handleWorkspaceReset(response: ServerResponse) {
  const project = await resetProject();
  sendJson(response, 200, buildWorkspaceReadModel(project));
}

async function handleWorkspaceFigmaSync(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const body = await readBody<FigmaSyncPayload>(request);
  const project = await readProject();
  const saved = await writeProject(applyFigmaSyncPayload({ project, payload: body }));
  sendJson(response, 200, buildWorkspaceReadModel(saved));
}

async function handleWorkspaceMappingStatus(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const body = await readBody<{
    mappingId?: string;
    status?: MappingStatus;
  }>(request);
  const mappingId = String(body.mappingId || "").trim();
  const status = body.status;

  if (!mappingId) {
    sendJson(response, 400, { ok: false, error: "mappingId is required" });
    return;
  }

  if (!status || !["planned", "prototype", "verified"].includes(status)) {
    sendJson(response, 400, { ok: false, error: "status must be planned, prototype or verified" });
    return;
  }

  const project = await readProject();
  const mapping = project.componentMappings.find((item) => item.id === mappingId);
  if (!mapping) {
    sendJson(response, 404, { ok: false, error: "Mapping not found" });
    return;
  }

  const saved = await writeProject({
    ...project,
    componentMappings: project.componentMappings.map((item) =>
      item.id === mappingId ? { ...item, status } : item,
    ),
  });
  const savedMapping = saved.componentMappings.find((item) => item.id === mappingId);
  if (!savedMapping) {
    sendJson(response, 500, { ok: false, error: "Saved mapping missing" });
    return;
  }

  sendJson(
    response,
    200,
    buildWorkspaceMappingStatusReceipt({
      project: saved,
      mapping: savedMapping,
    }),
  );
}

async function handleWorkspaceLibraryAssetSearch(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const body = await readBody<{
    query?: string;
    kind?: LibraryAssetKind;
    sourceId?: string;
    limit?: number;
  }>(request);

  if (body.kind !== undefined && !libraryAssetKinds.includes(body.kind)) {
    sendJson(response, 400, {
      ok: false,
      error: `kind must be one of ${libraryAssetKinds.join(", ")}`,
    });
    return;
  }

  const project = await readProject();
  sendJson(
    response,
    200,
    buildWorkspaceLibraryAssetSearchResponse({
      project,
      query: body.query,
      kind: body.kind,
      sourceId: typeof body.sourceId === "string" ? body.sourceId.trim() || undefined : undefined,
      limit: body.limit,
    }),
  );
}

async function handleWorkspaceReviewQueueItem(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const body = await readBody<{
    reviewId?: string;
    status?: ReviewStatus;
    owner?: string;
  }>(request);
  const reviewId = String(body.reviewId || "").trim();
  const status = body.status;
  const owner =
    typeof body.owner === "string"
      ? body.owner.trim()
      : undefined;

  if (!reviewId) {
    sendJson(response, 400, { ok: false, error: "reviewId is required" });
    return;
  }

  if (status === undefined && owner === undefined) {
    sendJson(response, 400, { ok: false, error: "status or owner is required" });
    return;
  }

  if (status !== undefined && !["todo", "doing", "done"].includes(status)) {
    sendJson(response, 400, { ok: false, error: "status must be todo, doing or done" });
    return;
  }

  if (typeof body.owner === "string" && !owner) {
    sendJson(response, 400, { ok: false, error: "owner must not be empty" });
    return;
  }

  const project = await readProject();
  const review = project.reviewItems.find((item) => item.id === reviewId);
  if (!review) {
    sendJson(response, 404, { ok: false, error: "Review item not found" });
    return;
  }

  const saved = await writeProject({
    ...project,
    reviewItems: project.reviewItems.map((item) =>
      item.id === reviewId
        ? {
            ...item,
            status: status ?? item.status,
            owner: owner ?? item.owner,
          }
        : item,
    ),
  });
  const savedReview = saved.reviewItems.find((item) => item.id === reviewId);
  if (!savedReview) {
    sendJson(response, 500, { ok: false, error: "Saved review item missing" });
    return;
  }

  sendJson(
    response,
    200,
    buildWorkspaceReviewQueueUpdateReceipt({
      project: saved,
      review: savedReview,
    }),
  );
}

export async function tryHandleWorkspaceRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
): Promise<boolean> {
  if (context.pathname === "/api/workspace/read-model" && context.method === "GET") {
    await handleWorkspaceReadModel(response);
    return true;
  }

  if (context.pathname === "/api/workspace/reset" && context.method === "POST") {
    await handleWorkspaceReset(response);
    return true;
  }

  if (context.pathname === "/api/workspace/figma-sync" && context.method === "POST") {
    await handleWorkspaceFigmaSync(request, response);
    return true;
  }

  if (context.pathname === "/api/workspace/mapping-status" && context.method === "POST") {
    await handleWorkspaceMappingStatus(request, response);
    return true;
  }

  if (context.pathname === "/api/workspace/review-queue-item" && context.method === "POST") {
    await handleWorkspaceReviewQueueItem(request, response);
    return true;
  }

  if (context.pathname === "/api/workspace/library-assets/search" && context.method === "POST") {
    await handleWorkspaceLibraryAssetSearch(request, response);
    return true;
  }

  return false;
}
