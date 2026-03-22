import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDirectory = path.resolve(__dirname, "..");
const pluginDirectory = path.join(rootDirectory, "plugins/autodesign");
const uiSource = "src/ui.html";
const lockPath = path.join(pluginDirectory, "ui.lock.json");

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function writeLock() {
  const sourcePath = path.join(pluginDirectory, uiSource);
  const nextLock = {
    source: uiSource,
    sha256: sha256(await readFile(sourcePath, "utf8")),
    policy: "Do not change plugin UI unless the user explicitly requests a UI change.",
    updatedAt: new Date().toISOString(),
  };

  await writeFile(lockPath, JSON.stringify(nextLock, null, 2) + "\n", "utf8");
  console.log(`plugin ui lock updated: ${nextLock.sha256}`);
}

async function verifyLock() {
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const sourcePath = path.join(pluginDirectory, lock.source || uiSource);
  const actualHash = sha256(await readFile(sourcePath, "utf8"));

  ensure(
    actualHash === lock.sha256,
    [
      "plugin UI lock mismatch.",
      `expected: ${lock.sha256}`,
      `actual:   ${actualHash}`,
      "Revert the UI change, or update ui.lock.json only after the user explicitly asks for a UI change.",
    ].join("\n"),
  );

  console.log("plugin ui lock verified");
}

if (process.argv.includes("--write")) {
  await writeLock();
} else {
  await verifyLock();
}
