import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const catalogPath = path.join(root, "doc", "Capability-Catalog.md");
const registryModulePath = path.join(root, "shared", "plugin-capabilities.ts");

function extractImplementedDocIds(text) {
  const ids = [];
  const regex = /^\|\s+`([^`]+)`\s+\|\s+[^|]+\|\s+implemented\s+\|/gm;
  for (const match of text.matchAll(regex)) {
    ids.push(String(match[1]));
  }
  return ids;
}

async function main() {
  const failures = [];

  if (!existsSync(catalogPath)) {
    failures.push("missing doc: doc/Capability-Catalog.md");
  }
  if (!existsSync(registryModulePath)) {
    failures.push("missing registry: shared/plugin-capabilities.ts");
  }

  if (failures.length > 0) {
    console.error("check:capability-catalog failed");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  const catalogText = await readFile(catalogPath, "utf8");
  const registryModule = await import(pathToFileURL(registryModulePath).href);
  const implementedCapabilities = Array.isArray(registryModule.IMPLEMENTED_PLUGIN_CAPABILITIES)
    ? registryModule.IMPLEMENTED_PLUGIN_CAPABILITIES
    : [];

  const registryIds = implementedCapabilities.map((item) => String(item.id));
  const documentedImplementedIds = extractImplementedDocIds(catalogText);
  const documentedSet = new Set(documentedImplementedIds);
  const registrySet = new Set(registryIds);

  for (const capabilityId of registryIds) {
    if (!documentedSet.has(capabilityId)) {
      failures.push(`implemented capability missing from catalog: ${capabilityId}`);
    }
  }

  for (const capabilityId of documentedImplementedIds) {
    if (!registrySet.has(capabilityId)) {
      failures.push(`catalog marks capability as implemented but registry does not: ${capabilityId}`);
    }
  }

  if (failures.length > 0) {
    console.error("check:capability-catalog failed");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(`check:capability-catalog passed (${registryIds.length} implemented capabilities)`);
}

await main();
