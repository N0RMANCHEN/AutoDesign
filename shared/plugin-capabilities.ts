export type PluginCapabilityDomain =
  | "selection"
  | "fills-strokes-effects"
  | "geometry"
  | "styles"
  | "variables"
  | "text"
  | "layout-autolayout"
  | "components-instances"
  | "assets-images-export"
  | "pages-sections-navigation"
  | "libraries-publish-sync"
  | "annotations-dev-handoff";

export type PluginExecutionMode = "strict" | "best-effort";

export type PluginCapabilityPayloadMap = {
  "selection.refresh": Record<string, never>;
  "fills.set-fill": { hex: string };
  "strokes.set-stroke": { hex: string };
  "geometry.set-radius": { value: number };
  "nodes.set-opacity": { value: number };
  "styles.upsert-paint-style": {
    name: string;
    hex: string;
    applyToSelection?: boolean;
  };
  "variables.upsert-color-variable": {
    collectionName: string;
    variableName: string;
    hex: string;
    bindToSelection?: boolean;
  };
};

export type PluginCapabilityId = keyof PluginCapabilityPayloadMap;

export type PluginCapabilityDescriptor = {
  id: PluginCapabilityId;
  domain: PluginCapabilityDomain;
  label: string;
  description: string;
  supportedEditorTypes: Array<"figma" | "figjam" | "dev" | "slides" | "buzz">;
  requiresSelection: boolean;
  requiresEditAccess: boolean;
  requiresPaidFeature: boolean;
};

export const IMPLEMENTED_PLUGIN_CAPABILITIES: PluginCapabilityDescriptor[] = [
  {
    id: "selection.refresh",
    domain: "selection",
    label: "Refresh selection",
    description: "Read the current selection and update the plugin session context.",
    supportedEditorTypes: ["figma"],
    requiresSelection: false,
    requiresEditAccess: false,
    requiresPaidFeature: false,
  },
  {
    id: "fills.set-fill",
    domain: "fills-strokes-effects",
    label: "Set fill",
    description: "Replace the current selection fill with a solid color.",
    supportedEditorTypes: ["figma"],
    requiresSelection: true,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "strokes.set-stroke",
    domain: "fills-strokes-effects",
    label: "Set stroke",
    description: "Replace the current selection stroke with a solid color.",
    supportedEditorTypes: ["figma"],
    requiresSelection: true,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "geometry.set-radius",
    domain: "geometry",
    label: "Set radius",
    description: "Update the corner radius of the current selection.",
    supportedEditorTypes: ["figma"],
    requiresSelection: true,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "nodes.set-opacity",
    domain: "fills-strokes-effects",
    label: "Set opacity",
    description: "Update the opacity of the current selection.",
    supportedEditorTypes: ["figma"],
    requiresSelection: true,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "styles.upsert-paint-style",
    domain: "styles",
    label: "Upsert paint style",
    description: "Create or update a local paint style and optionally apply it to the selection.",
    supportedEditorTypes: ["figma"],
    requiresSelection: false,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "variables.upsert-color-variable",
    domain: "variables",
    label: "Upsert color variable",
    description: "Create or update a local color variable and optionally bind it to the selection.",
    supportedEditorTypes: ["figma"],
    requiresSelection: false,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
];

export function getPluginCapabilityDescriptor(capabilityId: PluginCapabilityId) {
  return IMPLEMENTED_PLUGIN_CAPABILITIES.find((item) => item.id === capabilityId) || null;
}
