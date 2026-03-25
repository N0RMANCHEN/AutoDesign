import type { IncomingMessage, ServerResponse } from "node:http";

import type { RequestContext } from "./request-context.js";
import { tryHandleReconstructionDesignQueryRoute } from "./reconstruction-design-query-routes.js";
import { tryHandleReconstructionDesignReviewRoute } from "./reconstruction-design-review-routes.js";

export async function tryHandleReconstructionDesignRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
): Promise<boolean> {
  if (await tryHandleReconstructionDesignQueryRoute(request, response, context)) {
    return true;
  }
  if (await tryHandleReconstructionDesignReviewRoute(request, response, context)) {
    return true;
  }
  return false;
}
