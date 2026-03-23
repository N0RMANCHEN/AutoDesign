import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const rulesPath = path.join(root, "config/governance/doc_code_consistency_rules.json");

async function readText(repoPath) {
  return readFile(path.join(root, repoPath), "utf8");
}

async function main() {
  if (!existsSync(rulesPath)) {
    console.error("doc-code consistency rules missing: config/governance/doc_code_consistency_rules.json");
    process.exit(1);
  }

  const rules = JSON.parse(await readFile(rulesPath, "utf8"));
  const failures = [];

  for (const repoPath of rules.requiredDocs ?? []) {
    if (!existsSync(path.join(root, repoPath))) {
      failures.push(`required doc missing: ${repoPath}`);
    }
  }

  for (const item of rules.pathReferences ?? []) {
    const doc = String(item.doc ?? "");
    const targetPath = String(item.path ?? "");
    if (!doc || !targetPath) {
      failures.push("pathReferences entry requires doc and path");
      continue;
    }
    const docAbs = path.join(root, doc);
    const targetAbs = path.join(root, targetPath);
    if (!existsSync(docAbs)) {
      failures.push(`pathReferences doc missing: ${doc}`);
      continue;
    }
    if (!existsSync(targetAbs)) {
      failures.push(`pathReferences target missing: ${targetPath}`);
      continue;
    }
    const text = await readText(doc);
    if (!text.includes(targetPath)) {
      failures.push(`path reference not found in ${doc}: ${targetPath}`);
    }
  }

  for (const item of rules.fieldAssertions ?? []) {
    const doc = String(item.doc ?? "");
    const mustContain = String(item.mustContain ?? "");
    if (!doc || !mustContain) {
      failures.push("fieldAssertions entry requires doc and mustContain");
      continue;
    }
    const abs = path.join(root, doc);
    if (!existsSync(abs)) {
      failures.push(`fieldAssertions doc missing: ${doc}`);
      continue;
    }
    const text = await readText(doc);
    if (!text.includes(mustContain)) {
      failures.push(`field assertion missing in ${doc}: "${mustContain}"`);
    }
  }

  if (failures.length > 0) {
    console.error("check:doc-consistency failed");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("check:doc-consistency passed");
}

await main();
