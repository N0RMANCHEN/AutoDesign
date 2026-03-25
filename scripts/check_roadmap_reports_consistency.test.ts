import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "check_roadmap_reports_consistency.mjs");

async function withTempRepo<T>(run: (tempDir: string) => Promise<T>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-roadmap-reports-test-"));
  try {
    await mkdir(path.join(tempDir, "config", "governance"), { recursive: true });
    await mkdir(path.join(tempDir, "doc", "plans", "archive"), { recursive: true });
    await mkdir(path.join(tempDir, "reports", "acceptance"), { recursive: true });
    await mkdir(path.join(tempDir, "reports", "quality"), { recursive: true });
    await mkdir(path.join(tempDir, "schemas"), { recursive: true });
    return await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeRules(tempDir: string) {
  const rules = {
    roadmapSemantics: {
      roadmapDoc: "doc/Roadmap.md",
      archiveDoc: "doc/plans/archive/README.md",
      allowedStatuses: ["todo", "in_progress", "blocked", "acceptance_pending"],
      requiredMentions: [
        { doc: "doc/Roadmap.md", mustContain: "`support_boundary`" },
        { doc: "doc/plans/README.md", mustContain: "archive/README.md" },
        { doc: "doc/plans/archive/README.md", mustContain: "已关闭任务如果再次漂移，必须新开 task，不回写旧 closure。" },
      ],
      forbiddenPatterns: [
        { doc: "doc/Roadmap.md", pattern: "状态：`done`", description: "Roadmap live queue must not use done status" },
      ],
      reportContractFiles: [
        "reports/acceptance/TEMPLATE.md",
        "reports/acceptance/TEMPLATE.json",
        "reports/acceptance/RUNBOOK.md",
        "reports/quality/TEMPLATE.md",
        "reports/quality/TEMPLATE.json",
        "reports/quality/RUNBOOK.md",
        "schemas/acceptance-report.schema.json",
        "schemas/quality-report.schema.json",
      ],
    },
  };
  await writeFile(
    path.join(tempDir, "config", "governance", "doc_code_consistency_rules.json"),
    JSON.stringify(rules, null, 2),
    "utf8",
  );
}

async function writeCommonFixture(tempDir: string) {
  await writeFile(path.join(tempDir, "doc", "plans", "README.md"), "See archive/README.md for closed tasks.", "utf8");
  await writeFile(
    path.join(tempDir, "doc", "plans", "archive", "README.md"),
    "已关闭任务如果再次漂移，必须新开 task，不回写旧 closure。",
    "utf8",
  );
  await writeFile(path.join(tempDir, "doc", "plans", "r1.md"), "# R1 Plan\n", "utf8");
  await writeFile(path.join(tempDir, "reports", "acceptance", "TEMPLATE.md"), "# Acceptance\n", "utf8");
  await writeFile(path.join(tempDir, "reports", "acceptance", "TEMPLATE.json"), "{}\n", "utf8");
  await writeFile(path.join(tempDir, "reports", "acceptance", "RUNBOOK.md"), "# Acceptance Runbook\n", "utf8");
  await writeFile(path.join(tempDir, "reports", "quality", "TEMPLATE.md"), "# Quality\n", "utf8");
  await writeFile(path.join(tempDir, "reports", "quality", "TEMPLATE.json"), "{}\n", "utf8");
  await writeFile(path.join(tempDir, "reports", "quality", "RUNBOOK.md"), "# Quality Runbook\n", "utf8");
  await writeFile(path.join(tempDir, "schemas", "acceptance-report.schema.json"), "{}\n", "utf8");
  await writeFile(path.join(tempDir, "schemas", "quality-report.schema.json"), "{}\n", "utf8");
}

function buildRoadmap(statusLine: string, extraBody = "") {
  return `# Roadmap

## 2. Current

- \`support_boundary\`: test boundary

## 3. Active Work

### R1 EXAMPLE TASK

- 状态：\`${statusLine}\`
- 目标：test task
- Plan：[r1.md](plans/r1.md)
- 当前收口子任务：
  - closure task a
  - closure task b
- 完成判据：
  - exit gate a
  - exit gate b
${extraBody}

## 4. Archive Handoff

- archive pointer
`;
}

test("check_roadmap_reports_consistency passes for valid roadmap status, plan link and report contracts", async () => {
  await withTempRepo(async (tempDir) => {
    await writeRules(tempDir);
    await writeCommonFixture(tempDir);
    await writeFile(path.join(tempDir, "doc", "Roadmap.md"), buildRoadmap("in_progress"), "utf8");

    const { stdout } = await execFileAsync(process.execPath, [scriptPath], { cwd: tempDir });
    assert.match(stdout, /check:roadmap-reports passed/);
  });
});

test("check_roadmap_reports_consistency fails when a roadmap task uses a disallowed status", async () => {
  await withTempRepo(async (tempDir) => {
    await writeRules(tempDir);
    await writeCommonFixture(tempDir);
    await writeFile(path.join(tempDir, "doc", "Roadmap.md"), buildRoadmap("done"), "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath], { cwd: tempDir }),
      (error: any) => {
        const stderr = String(error.stderr || "");
        assert.match(stderr, /check:roadmap-reports failed/);
        assert.match(stderr, /roadmap task uses disallowed status done: R1 EXAMPLE TASK/);
        assert.match(stderr, /forbidden pattern matched in doc\/Roadmap\.md: Roadmap live queue must not use done status/);
        return true;
      },
    );
  });
});

test("check_roadmap_reports_consistency fails when acceptance_pending work omits acceptance_owner", async () => {
  await withTempRepo(async (tempDir) => {
    await writeRules(tempDir);
    await writeCommonFixture(tempDir);
    await writeFile(path.join(tempDir, "doc", "Roadmap.md"), buildRoadmap("acceptance_pending"), "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath], { cwd: tempDir }),
      (error: any) => {
        const stderr = String(error.stderr || "");
        assert.match(stderr, /check:roadmap-reports failed/);
        assert.match(stderr, /acceptance_pending task missing acceptance_owner: R1 EXAMPLE TASK/);
        return true;
      },
    );
  });
});

test("check_roadmap_reports_consistency fails when a roadmap task omits closure subtasks or completion criteria", async () => {
  await withTempRepo(async (tempDir) => {
    await writeRules(tempDir);
    await writeCommonFixture(tempDir);
    await writeFile(
      path.join(tempDir, "doc", "Roadmap.md"),
      `# Roadmap

## 2. Current

- \`support_boundary\`: test boundary

## 3. Active Work

### R1 EXAMPLE TASK

- 状态：\`in_progress\`
- 目标：test task
- Plan：[r1.md](plans/r1.md)

## 4. Archive Handoff

- archive pointer
`,
      "utf8",
    );

    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath], { cwd: tempDir }),
      (error: any) => {
        const stderr = String(error.stderr || "");
        assert.match(stderr, /check:roadmap-reports failed/);
        assert.match(stderr, /roadmap task missing 当前收口子任务: R1 EXAMPLE TASK/);
        assert.match(stderr, /roadmap task missing 完成判据: R1 EXAMPLE TASK/);
        return true;
      },
    );
  });
});
