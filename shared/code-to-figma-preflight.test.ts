import assert from "node:assert/strict";
import test from "node:test";

import { runCodeToFigmaPreflight } from "./code-to-figma-preflight.js";

test("runCodeToFigmaPreflight passes a simple static desktop page", () => {
  const report = runCodeToFigmaPreflight({
    projectRoot: "/tmp/static-page",
    projectName: "static-page",
    entryPaths: ["src/App.tsx"],
    files: [
      {
        path: "src/App.tsx",
        kind: "script",
        content: `
          export default function App() {
            return <main className="page"><h1>Hello</h1><p>World</p></main>;
          }
        `,
      },
      {
        path: "src/index.css",
        kind: "css",
        content: `
          .page {
            width: 1440px;
            padding: 24px;
            background: #ffffff;
          }
        `,
      },
    ],
  });

  assert.equal(report.supported, true);
  assert.equal(report.summary.blocked, false);
  assert.equal(report.summary.errorCount, 0);
  assert.equal(report.summary.warningCount, 0);
  assert.deepEqual(report.blockers, []);
});

test("runCodeToFigmaPreflight blocks unsupported CSS and interactive React inputs", () => {
  const report = runCodeToFigmaPreflight({
    projectRoot: "/tmp/blocked-page",
    projectName: "blocked-page",
    entryPaths: ["src/App.tsx"],
    files: [
      {
        path: "src/App.tsx",
        kind: "script",
        content: `
          import { useState } from "react";

          export default function App() {
            const [open, setOpen] = useState(false);
            return <button onClick={() => setOpen(!open)}>{open ? <span>Open</span> : <span>Closed</span>}</button>;
          }
        `,
      },
      {
        path: "src/index.css",
        kind: "css",
        content: `
          .page {
            display: grid;
            width: min(1496px, calc(100% - 56px));
            font-family: "Didot", "Times New Roman", serif;
            aspect-ratio: 4 / 5;
          }
        `,
      },
    ],
  });

  assert.equal(report.supported, false);
  assert.equal(report.summary.blocked, true);
  assert.equal(report.summary.errorCount >= 2, true);
  assert.equal(report.summary.warningCount >= 4, true);
  assert.equal(report.blockers.includes("jsx-event-handler"), true);
  assert.equal(report.blockers.includes("stateful-react-hook"), true);
  assert.equal(
    report.findings.some((finding) => finding.code === "css-grid-layout" && finding.severity === "warning"),
    true,
  );
  assert.equal(
    report.findings.some((finding) => finding.code === "responsive-css-function" && finding.severity === "warning"),
    true,
  );
  assert.equal(
    report.findings.some((finding) => finding.code === "font-fallback-stack" && finding.severity === "warning"),
    true,
  );
  assert.equal(
    report.findings.some((finding) => finding.code === "conditional-rendering" && finding.severity === "warning"),
    true,
  );
});
