import assert from "node:assert/strict";
import test from "node:test";

import { hasExplicitCreationParent } from "./creation-command-handlers.js";
import { computeRasterPlacement } from "./asset-reconstruction-command-handlers.js";

test("hasExplicitCreationParent only accepts creation capabilities with parentNodeId", () => {
  assert.equal(
    hasExplicitCreationParent({
      type: "capability",
      capabilityId: "nodes.create-frame",
      payload: { parentNodeId: "12:3" },
    } as any),
    true,
  );
  assert.equal(
    hasExplicitCreationParent({
      type: "capability",
      capabilityId: "fills.set-fill",
      payload: { parentNodeId: "12:3" },
    } as any),
    false,
  );
});

test("computeRasterPlacement preserves target bounds for stretch and centers contain mode", () => {
  const stretch = computeRasterPlacement(200, 100, 20, 20, "stretch");
  const contain = computeRasterPlacement(200, 100, 100, 100, "contain");

  assert.deepEqual(stretch, {
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    scaleMode: "FILL",
  });
  assert.equal(contain.width, 100);
  assert.equal(contain.height, 100);
  assert.equal(contain.x, 50);
  assert.equal(contain.y, 0);
});
