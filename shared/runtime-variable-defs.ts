import type {
  PluginBridgeSession,
  PluginVariableCollectionSummary,
  PluginVariableDefinition,
  PluginVariableModeValue,
} from "./plugin-bridge.js";

export type RuntimeVariableDefsSnapshot = {
  available: boolean;
  source: "plugin-session-variable-snapshot" | null;
  note: string;
  colors: string[];
  spacing: string[];
  typography: string[];
  collections: PluginVariableCollectionSummary[];
  variables: PluginVariableDefinition[];
};

function formatModeValue(value: PluginVariableModeValue | undefined) {
  if (!value) {
    return "unresolved";
  }

  if (value.value === null) {
    return value.kind === "unknown" ? "unknown" : "unresolved";
  }

  return String(value.value);
}

function pickPrimaryModeValue(
  variable: PluginVariableDefinition,
  collections: PluginVariableCollectionSummary[],
) {
  const collection = collections.find((item) => item.id === variable.collectionId);
  if (collection?.defaultModeId) {
    const matched = variable.valuesByMode.find((value) => value.modeId === collection.defaultModeId);
    if (matched) {
      return matched;
    }
  }

  return variable.valuesByMode[0];
}

function summarizeVariable(
  variable: PluginVariableDefinition,
  collections: PluginVariableCollectionSummary[],
) {
  const primaryValue = pickPrimaryModeValue(variable, collections);
  return `${variable.collectionName}/${variable.name} = ${formatModeValue(primaryValue)}`;
}

function matchesKeywords(variable: PluginVariableDefinition, keywords: string[]) {
  const haystack = [
    variable.collectionName,
    variable.name,
    ...variable.scopes,
  ]
    .join(" ")
    .toLowerCase();

  return keywords.some((keyword) => haystack.includes(keyword));
}

function summarizeColors(
  variables: PluginVariableDefinition[],
  collections: PluginVariableCollectionSummary[],
) {
  return variables
    .filter((variable) => variable.resolvedType === "COLOR")
    .map((variable) => summarizeVariable(variable, collections));
}

function summarizeSpacing(
  variables: PluginVariableDefinition[],
  collections: PluginVariableCollectionSummary[],
) {
  return variables
    .filter((variable) => variable.resolvedType === "FLOAT")
    .filter((variable) =>
      matchesKeywords(variable, [
        "space",
        "spacing",
        "gap",
        "padding",
        "margin",
        "radius",
        "corner",
        "width",
        "height",
      ]),
    )
    .map((variable) => summarizeVariable(variable, collections));
}

function summarizeTypography(
  variables: PluginVariableDefinition[],
  collections: PluginVariableCollectionSummary[],
) {
  return variables
    .filter((variable) =>
      matchesKeywords(variable, [
        "font",
        "text",
        "typography",
        "line height",
        "line-height",
        "letter spacing",
        "letter-spacing",
        "paragraph",
      ]),
    )
    .map((variable) => summarizeVariable(variable, collections));
}

export function buildUnavailableRuntimeVariableDefsSnapshot(
  note = "当前 workspace project model 还没有真实的 variables/styles truth；如需 live token 读取，请继续通过 plugin runtime inspect/preview 能力补链。",
): RuntimeVariableDefsSnapshot {
  return {
    available: false,
    source: null,
    note,
    colors: [],
    spacing: [],
    typography: [],
    collections: [],
    variables: [],
  };
}

export function buildRuntimeVariableDefsSnapshot(params?: {
  pluginSession?: Pick<
    PluginBridgeSession,
    "hasVariableSnapshot" | "variableCollections" | "variables"
  > | null;
}): RuntimeVariableDefsSnapshot {
  const pluginSession = params?.pluginSession;
  if (pluginSession?.hasVariableSnapshot !== true) {
    return buildUnavailableRuntimeVariableDefsSnapshot();
  }

  const collections = Array.isArray(pluginSession.variableCollections)
    ? pluginSession.variableCollections
    : [];
  const variables = Array.isArray(pluginSession.variables) ? pluginSession.variables : [];

  if (!collections.length && !variables.length) {
    return {
      available: true,
      source: "plugin-session-variable-snapshot",
      note: "plugin session 已回报 live variable snapshot，但当前 Figma 文件没有本地 variables。",
      colors: [],
      spacing: [],
      typography: [],
      collections,
      variables,
    };
  }

  return {
    available: true,
    source: "plugin-session-variable-snapshot",
    note: "variables 来自 plugin live session；colors/spacing/typography 摘要桶使用 collection/name/scope 的保守归类。",
    colors: summarizeColors(variables, collections),
    spacing: summarizeSpacing(variables, collections),
    typography: summarizeTypography(variables, collections),
    collections,
    variables,
  };
}
