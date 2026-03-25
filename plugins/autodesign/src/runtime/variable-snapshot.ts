import type {
  PluginVariableCollectionSummary,
  PluginVariableDefinition,
  PluginVariableModeValue,
} from "../../../../shared/plugin-bridge.js";

const LOCAL_VARIABLE_TYPES = ["COLOR", "FLOAT", "STRING", "BOOLEAN"] as const;

function channelToHex(value: number) {
  const normalized = Math.max(0, Math.min(255, Math.round(value * 255)));
  return normalized.toString(16).padStart(2, "0").toUpperCase();
}

function rgbaToHex(value: { r: number; g: number; b: number; a?: number }) {
  const alpha = typeof value.a === "number" ? value.a : 1;
  const base = `#${channelToHex(value.r)}${channelToHex(value.g)}${channelToHex(value.b)}`;
  return alpha >= 1 ? base : `${base}${channelToHex(alpha)}`;
}

function isAliasValue(value: unknown): value is { type: string; id: string } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "type" in value &&
      "id" in value &&
      (value as { type?: unknown }).type === "VARIABLE_ALIAS" &&
      typeof (value as { id?: unknown }).id === "string",
  );
}

function normalizeModeValue(
  value: unknown,
  modeName: string | null,
): PluginVariableModeValue {
  if (typeof value === "boolean") {
    return { modeId: "", modeName, kind: "boolean", value };
  }

  if (typeof value === "number") {
    return { modeId: "", modeName, kind: "number", value };
  }

  if (typeof value === "string") {
    return { modeId: "", modeName, kind: "string", value };
  }

  if (
    value &&
    typeof value === "object" &&
    "r" in value &&
    "g" in value &&
    "b" in value &&
    typeof (value as { r?: unknown }).r === "number" &&
    typeof (value as { g?: unknown }).g === "number" &&
    typeof (value as { b?: unknown }).b === "number"
  ) {
    return {
      modeId: "",
      modeName,
      kind: "color",
      value: rgbaToHex(value as { r: number; g: number; b: number; a?: number }),
    };
  }

  if (isAliasValue(value)) {
    return {
      modeId: "",
      modeName,
      kind: "alias",
      value: `alias:${value.id}`,
    };
  }

  return {
    modeId: "",
    modeName,
    kind: "unknown",
    value: null,
  };
}

export function normalizeVariableCollections(
  collections: any[],
): PluginVariableCollectionSummary[] {
  return collections
    .map((collection) => {
      const modes = Array.isArray(collection?.modes)
        ? collection.modes
            .map((mode: any) =>
              mode && typeof mode.modeId === "string"
                ? {
                    modeId: mode.modeId,
                    name: typeof mode.name === "string" ? mode.name : mode.modeId,
                  }
                : null,
            )
            .filter(
              (
                mode: { modeId: string; name: string } | null,
              ): mode is { modeId: string; name: string } => Boolean(mode),
            )
        : [];
      const defaultModeId =
        typeof collection?.defaultModeId === "string"
          ? collection.defaultModeId
          : (modes[0]?.modeId ?? "");

      return {
        id: String(collection?.id || ""),
        name: String(collection?.name || "Unnamed Collection"),
        defaultModeId,
        hiddenFromPublishing: Boolean(collection?.hiddenFromPublishing),
        modes,
      };
    })
    .filter((collection) => collection.id)
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

export function normalizeVariables(params: {
  variables: any[];
  collections: PluginVariableCollectionSummary[];
}): PluginVariableDefinition[] {
  const { variables, collections } = params;
  const collectionById = new Map(collections.map((collection) => [collection.id, collection]));

  return variables
    .map((variable) => {
      const collection = collectionById.get(String(variable?.variableCollectionId || ""));
      const modeOrder = new Map(
        (collection?.modes ?? []).map((mode, index) => [mode.modeId, index]),
      );
      const valuesByModeSource =
        variable && typeof variable === "object" && variable.valuesByMode
          ? (variable.valuesByMode as Record<string, unknown>)
          : {};
      const valuesByMode = Object.entries(valuesByModeSource)
        .map(([modeId, rawValue]) => {
          const modeName =
            collection?.modes.find((mode) => mode.modeId === modeId)?.name ?? null;
          const normalized = normalizeModeValue(rawValue, modeName);
          return {
            ...normalized,
            modeId,
          };
        })
        .sort((left, right) => {
          const leftOrder = modeOrder.get(left.modeId) ?? Number.MAX_SAFE_INTEGER;
          const rightOrder = modeOrder.get(right.modeId) ?? Number.MAX_SAFE_INTEGER;
          if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
          }
          return left.modeId.localeCompare(right.modeId);
        });

      return {
        id: String(variable?.id || ""),
        name: String(variable?.name || "Unnamed Variable"),
        collectionId: String(variable?.variableCollectionId || ""),
        collectionName: collection?.name || "Unknown Collection",
        resolvedType:
          variable?.resolvedType === "COLOR" ||
          variable?.resolvedType === "FLOAT" ||
          variable?.resolvedType === "STRING" ||
          variable?.resolvedType === "BOOLEAN"
            ? variable.resolvedType
            : "STRING",
        hiddenFromPublishing: Boolean(variable?.hiddenFromPublishing),
        scopes: Array.isArray(variable?.scopes)
          ? variable.scopes.map((scope: unknown) => String(scope))
          : [],
        valuesByMode,
      } satisfies PluginVariableDefinition;
    })
    .filter((variable) => variable.id)
    .sort((left, right) => {
      const collectionOrder = left.collectionName.localeCompare(right.collectionName);
      if (collectionOrder !== 0) {
        return collectionOrder;
      }
      return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
    });
}

export async function readLocalVariableSnapshot() {
  const rawCollections = await figma.variables.getLocalVariableCollectionsAsync();
  const variableCollections = normalizeVariableCollections(rawCollections);
  const rawVariables = await Promise.all(
    LOCAL_VARIABLE_TYPES.map((type) => figma.variables.getLocalVariablesAsync(type)),
  );
  const variables = normalizeVariables({
    variables: rawVariables.flat(),
    collections: variableCollections,
  });

  return {
    hasVariableSnapshot: true,
    variableCollections,
    variables,
  };
}
