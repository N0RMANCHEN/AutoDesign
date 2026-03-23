import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const truthPath = path.join(root, "config/governance/product_boundary_truth.json");

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

async function main() {
  if (!existsSync(truthPath)) {
    fail("product boundary truth missing: config/governance/product_boundary_truth.json");
    return;
  }

  const truth = JSON.parse(await readFile(truthPath, "utf8"));
  const failures = [];

  const categories = ["formalSupport", "experimental", "futureTarget"];
  for (const category of categories) {
    const entries = Array.isArray(truth.supportBoundary?.[category]) ? truth.supportBoundary[category] : [];
    if (entries.length === 0) {
      failures.push(`supportBoundary.${category} must contain at least one entry`);
      continue;
    }
    const ids = new Set();
    for (const entry of entries) {
      const id = String(entry.id ?? "");
      const label = String(entry.label ?? "");
      if (!id || !label) {
        failures.push(`supportBoundary.${category} entries require id and label`);
        continue;
      }
      if (ids.has(id)) {
        failures.push(`duplicate product boundary id in ${category}: ${id}`);
      }
      ids.add(id);
    }
  }

  const docAssertions = Array.isArray(truth.docAssertions) ? truth.docAssertions : [];
  if (docAssertions.length === 0) {
    failures.push("product boundary truth requires docAssertions");
  }

  for (const assertion of docAssertions) {
    const doc = String(assertion.doc ?? "");
    const snippets = Array.isArray(assertion.snippets) ? assertion.snippets.map(String) : [];
    if (!doc || snippets.length === 0) {
      failures.push("each docAssertion requires doc and snippets");
      continue;
    }
    const abs = path.join(root, doc);
    if (!existsSync(abs)) {
      failures.push(`docAssertion target missing: ${doc}`);
      continue;
    }
    const text = await readFile(abs, "utf8");
    for (const snippet of snippets) {
      if (!text.includes(snippet)) {
        failures.push(`product boundary drift: ${doc} missing "${snippet}"`);
      }
    }
  }

  if (failures.length > 0) {
    console.error("check:product-boundary failed");
    for (const item of failures) {
      console.error(`- ${item}`);
    }
    process.exit(1);
  }

  console.log("check:product-boundary passed");
}

await main();
