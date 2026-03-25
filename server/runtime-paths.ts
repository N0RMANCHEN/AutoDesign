import path from "node:path";

export function resolveDataDirectory() {
  const explicitDataDir = process.env.AUTODESIGN_DATA_DIR;
  if (explicitDataDir) {
    return path.resolve(explicitDataDir);
  }
  return path.join(process.cwd(), "data");
}
