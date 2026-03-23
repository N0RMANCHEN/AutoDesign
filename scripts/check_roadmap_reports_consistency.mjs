import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const rulesPath = path.join(root, "config/governance/doc_code_consistency_rules.json");

async function readText(repoPath) {
  return readFile(path.join(root, repoPath), "utf8");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTaskSections(text) {
  const regex = /^###\s+([A-Z0-9/ -]+)\n([\s\S]*?)(?=^###\s+|\n##\s|\Z)/gm;
  return [...text.matchAll(regex)].map((match) => ({
    heading: String(match[1] ?? "").trim(),
    body: String(match[2] ?? ""),
  }));
}

async function main() {
  if (!existsSync(rulesPath)) {
    console.error("roadmap consistency rules missing: config/governance/doc_code_consistency_rules.json");
    process.exit(1);
  }

  const rules = JSON.parse(await readFile(rulesPath, "utf8"));
  const semantics = rules.roadmapSemantics ?? {};
  const failures = [];

  const roadmapDoc = String(semantics.roadmapDoc ?? "doc/Roadmap.md");
  const archiveDoc = String(semantics.archiveDoc ?? "doc/plans/archive/README.md");
  const allowedStatuses = new Set((semantics.allowedStatuses ?? []).map(String));

  if (!existsSync(path.join(root, roadmapDoc))) {
    failures.push(`roadmap missing: ${roadmapDoc}`);
  }
  if (!existsSync(path.join(root, archiveDoc))) {
    failures.push(`archive doc missing: ${archiveDoc}`);
  }

  const roadmapText = existsSync(path.join(root, roadmapDoc)) ? await readText(roadmapDoc) : "";

  for (const item of semantics.requiredMentions ?? []) {
    const doc = String(item.doc ?? "");
    const mustContain = String(item.mustContain ?? "");
    if (!doc || !mustContain) {
      failures.push("roadmap requiredMentions entry requires doc and mustContain");
      continue;
    }
    const abs = path.join(root, doc);
    if (!existsSync(abs)) {
      failures.push(`roadmap requiredMentions doc missing: ${doc}`);
      continue;
    }
    const text = await readText(doc);
    if (!text.includes(mustContain)) {
      failures.push(`required mention missing in ${doc}: "${mustContain}"`);
    }
  }

  for (const item of semantics.forbiddenPatterns ?? []) {
    const doc = String(item.doc ?? "");
    const pattern = String(item.pattern ?? "");
    const description = String(item.description ?? pattern);
    if (!doc || !pattern) {
      failures.push("roadmap forbiddenPatterns entry requires doc and pattern");
      continue;
    }
    const abs = path.join(root, doc);
    if (!existsSync(abs)) {
      failures.push(`roadmap forbiddenPatterns doc missing: ${doc}`);
      continue;
    }
    const text = await readText(doc);
    if (new RegExp(pattern, "m").test(text)) {
      failures.push(`forbidden pattern matched in ${doc}: ${description}`);
    }
  }

  const sections = extractTaskSections(roadmapText).filter((section) => /^R\d+\b/.test(section.heading));
  for (const section of sections) {
    const status = /^- 状态：`([^`]+)`/m.exec(section.body)?.[1] ?? null;
    if (!status) {
      failures.push(`roadmap task missing status: ${section.heading}`);
      continue;
    }
    if (!allowedStatuses.has(status)) {
      failures.push(`roadmap task uses disallowed status ${status}: ${section.heading}`);
    }
    const planMatch = /- Plan：\[.+?\]\(([^)]+)\)|- Plan:\s*\[.+?\]\(([^)]+)\)/m.exec(section.body);
    const planPath = planMatch?.[1] ?? planMatch?.[2] ?? null;
    if (!planPath) {
      failures.push(`roadmap task missing plan link: ${section.heading}`);
    } else if (!existsSync(path.join(root, "doc", planPath))) {
      failures.push(`roadmap plan target missing for ${section.heading}: doc/${planPath}`);
    }
    if (status === "acceptance_pending" && !section.body.includes("acceptance_owner")) {
      failures.push(`acceptance_pending task missing acceptance_owner: ${section.heading}`);
    }
  }

  for (const repoPath of semantics.reportContractFiles ?? []) {
    if (!existsSync(path.join(root, repoPath))) {
      failures.push(`report contract file missing: ${repoPath}`);
    }
  }

  if (failures.length > 0) {
    console.error("check:roadmap-reports failed");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("check:roadmap-reports passed");
}

await main();
