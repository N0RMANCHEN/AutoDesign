import assert from "node:assert/strict";
import test from "node:test";

import {
  IMPLEMENTED_PLUGIN_CAPABILITIES,
  getPluginCapabilityDescriptor,
} from "./plugin-capabilities.js";

test("implemented capability descriptors use unique ids", () => {
  const ids = IMPLEMENTED_PLUGIN_CAPABILITIES.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("implemented capability descriptors expose non-empty labels, descriptions and editor types", () => {
  for (const descriptor of IMPLEMENTED_PLUGIN_CAPABILITIES) {
    assert.ok(descriptor.label.trim().length > 0, `${descriptor.id} must have a label`);
    assert.ok(descriptor.description.trim().length > 0, `${descriptor.id} must have a description`);
    assert.ok(descriptor.supportedEditorTypes.length > 0, `${descriptor.id} must support at least one editor`);
  }
});

test("getPluginCapabilityDescriptor resolves every implemented capability id", () => {
  for (const descriptor of IMPLEMENTED_PLUGIN_CAPABILITIES) {
    assert.deepEqual(getPluginCapabilityDescriptor(descriptor.id), descriptor);
  }
});

test("getPluginCapabilityDescriptor returns null for unknown ids at runtime", () => {
  assert.equal(getPluginCapabilityDescriptor("unknown.capability" as never), null);
});
