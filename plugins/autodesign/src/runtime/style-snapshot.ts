import type { PluginStyleDefinition } from "../../../../shared/plugin-bridge.js";

function normalizeStyleDefinitions(
  styleType: PluginStyleDefinition["styleType"],
  styles: any[],
): PluginStyleDefinition[] {
  return styles
    .map((style) => ({
      id: String(style?.id || ""),
      styleType,
      name: String(style?.name || "Unnamed Style"),
      description:
        typeof style?.description === "string" && style.description.trim()
          ? style.description.trim()
          : null,
    }))
    .filter((style) => style.id)
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

export function normalizeStyleSnapshot(params: {
  paintStyles?: any[];
  textStyles?: any[];
  effectStyles?: any[];
  gridStyles?: any[];
}) {
  const styles = [
    ...normalizeStyleDefinitions("paint", params.paintStyles ?? []),
    ...normalizeStyleDefinitions("text", params.textStyles ?? []),
    ...normalizeStyleDefinitions("effect", params.effectStyles ?? []),
    ...normalizeStyleDefinitions("grid", params.gridStyles ?? []),
  ].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));

  return {
    hasStyleSnapshot: true,
    styles,
  };
}

export async function readLocalStyleSnapshot() {
  const effectReader = (figma as any).getLocalEffectStylesAsync;
  const gridReader = (figma as any).getLocalGridStylesAsync;
  const [paintStyles, textStyles, effectStyles, gridStyles] = await Promise.all([
    figma.getLocalPaintStylesAsync(),
    figma.getLocalTextStylesAsync(),
    typeof effectReader === "function" ? effectReader.call(figma) : Promise.resolve([]),
    typeof gridReader === "function" ? gridReader.call(figma) : Promise.resolve([]),
  ]);

  return normalizeStyleSnapshot({
    paintStyles,
    textStyles,
    effectStyles,
    gridStyles,
  });
}
