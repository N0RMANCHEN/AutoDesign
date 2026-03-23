import { spawnSync } from "node:child_process";

const defaultSteps = [
  ["npm", ["run", "verify:docs"]],
  ["npm", ["run", "check:product-boundary"]],
  ["npm", ["run", "check:doc-consistency"]],
  ["npm", ["run", "check:roadmap-reports"]],
  ["npm", ["run", "check:report-schemas"]],
  ["npm", ["run", "check:capability-catalog"]],
  ["npm", ["run", "governance:check"]],
  ["npm", ["run", "typecheck"]],
  ["npm", ["run", "test:unit"]],
  ["npm", ["run", "verify:plugins"]],
];

const steps = process.env.AUTODESIGN_VERIFY_STEPS_JSON
  ? JSON.parse(process.env.AUTODESIGN_VERIFY_STEPS_JSON)
  : defaultSteps;

for (const [command, args] of steps) {
  console.log(`[verify] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("[verify] ok");
