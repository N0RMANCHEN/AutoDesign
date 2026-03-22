export type PluginCapabilityDomain =
  | "selection"
  | "nodes"
  | "fills-strokes-effects"
  | "geometry"
  | "styles"
  | "variables"
  | "text"
  | "layout-autolayout"
  | "components-instances"
  | "assets-images-export"
  | "reconstruction"
  | "pages-sections-navigation"
  | "libraries-publish-sync"
  | "annotations-dev-handoff"
  | "undo";

export type PluginExecutionMode = "strict" | "best-effort";

export type PluginCapabilityPayloadMap = {
  "selection.refresh": Record<string, never>;
  "fills.set-fill": { hex: string };
  "fills.clear-fill": Record<string, never>;
  "strokes.set-stroke": { hex: string };
  "strokes.clear-stroke": Record<string, never>;
  "strokes.set-weight": { value: number };
  "effects.set-shadow": {
    offsetX: number;
    offsetY: number;
    blur: number;
    spread?: number;
    colorHex?: string;
    opacity?: number;
  };
  "effects.set-layer-blur": { radius: number };
  "effects.clear-effects": Record<string, never>;
  "geometry.set-radius": { value: number };
  "geometry.set-size": { width: number; height: number };
  "geometry.set-position": { x: number; y: number };
  "nodes.set-opacity": { value: number };
  "nodes.rename": { name: string };
  "nodes.duplicate": { offsetX?: number; offsetY?: number };
  "nodes.group": { name?: string };
  "nodes.frame-selection": { name?: string; padding?: number };
  "nodes.create-frame": {
    name?: string;
    width: number;
    height: number;
    x?: number;
    y?: number;
    fillHex?: string;
    cornerRadius?: number;
    parentNodeId?: string;
  };
  "nodes.create-text": {
    name?: string;
    content: string;
    fontFamily?: string;
    fontStyle?: string;
    fontSize?: number;
    fontWeight?: number | string;
    colorHex?: string;
    lineHeight?: number;
    letterSpacing?: number;
    alignment?: "left" | "center" | "right" | "justified";
    x?: number;
    y?: number;
    parentNodeId?: string;
    analysisRefId?: string;
  };
  "nodes.create-rectangle": {
    name?: string;
    width: number;
    height: number;
    x?: number;
    y?: number;
    fillHex?: string;
    strokeHex?: string;
    strokeWeight?: number;
    cornerRadius?: number;
    opacity?: number;
    parentNodeId?: string;
    analysisRefId?: string;
  };
  "nodes.create-ellipse": {
    name?: string;
    width: number;
    height: number;
    x?: number;
    y?: number;
    fillHex?: string;
    strokeHex?: string;
    strokeWeight?: number;
    opacity?: number;
    parentNodeId?: string;
    analysisRefId?: string;
  };
  "nodes.create-line": {
    name?: string;
    width: number;
    height?: number;
    x?: number;
    y?: number;
    strokeHex?: string;
    strokeWeight?: number;
    opacity?: number;
    rotation?: number;
    parentNodeId?: string;
    analysisRefId?: string;
  };
  "nodes.create-svg": {
    name?: string;
    svgMarkup: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    opacity?: number;
    parentNodeId?: string;
    analysisRefId?: string;
  };
  "assets.export-node-image": {
    format?: "PNG";
    constraint?: { type: "WIDTH" | "HEIGHT" | "SCALE"; value: number };
    preferOriginalBytes?: boolean;
  };
  "reconstruction.apply-raster-reference": {
    referenceNodeId: string;
    resultName?: string;
    replaceTargetContents?: boolean;
    resizeTargetToReference?: boolean;
  };
  "text.set-content": { value: string };
  "text.set-font-size": { value: number };
  "text.set-font-family": { family: string; style?: string };
  "text.set-font-weight": { value: number | string };
  "text.set-text-color": { hex: string };
  "text.set-line-height": { value: number };
  "text.set-letter-spacing": { value: number };
  "text.set-alignment": { value: "left" | "center" | "right" | "justified" };
  "styles.upsert-text-style": {
    name: string;
    fontFamily: string;
    fontStyle?: string;
    fontSize: number;
    textColorHex?: string;
  };
  "styles.apply-style": {
    styleType: "paint" | "text";
    styleName: string;
  };
  "styles.detach-style": {
    styleType: "fill" | "stroke" | "text";
  };
  "styles.upsert-paint-style": {
    name: string;
    hex: string;
    applyToSelection?: boolean;
  };
  "nodes.delete": Record<string, never>;
  "undo.undo-last": Record<string, never>;
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
    id: "fills.clear-fill",
    domain: "fills-strokes-effects",
    label: "Clear fill",
    description: "Remove all fills from the current selection.",
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
    id: "strokes.clear-stroke",
    domain: "fills-strokes-effects",
    label: "Clear stroke",
    description: "Remove all strokes from the current selection.",
    supportedEditorTypes: ["figma"],
    requiresSelection: true,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "strokes.set-weight",
    domain: "fills-strokes-effects",
    label: "Set stroke weight",
    description: "Update the stroke weight of the current selection.",
    supportedEditorTypes: ["figma"],
    requiresSelection: true,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "effects.set-shadow",
    domain: "fills-strokes-effects",
    label: "Set shadow",
    description: "Create or update a drop shadow on the current selection.",
    supportedEditorTypes: ["figma"],
    requiresSelection: true,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "effects.set-layer-blur",
    domain: "fills-strokes-effects",
    label: "Set layer blur",
    description: "Create or update a layer blur effect on the current selection.",
    supportedEditorTypes: ["figma"],
    requiresSelection: true,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "effects.clear-effects",
    domain: "fills-strokes-effects",
    label: "Clear effects",
    description: "Remove all effects from the current selection.",
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
    id: "geometry.set-size",
    domain: "geometry",
    label: "Set size",
    description: "Resize the current selection to a fixed width and height.",
    supportedEditorTypes: ["figma"],
    requiresSelection: true,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "geometry.set-position",
    domain: "geometry",
    label: "Set position",
    description: "Move the current selection to an absolute x/y position.",
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
    id: "nodes.rename",
    domain: "nodes",
    label: "Rename nodes",
    description: "Rename the current selection.",
    supportedEditorTypes: ["figma"],
    requiresSelection: true,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "nodes.duplicate",
    domain: "nodes",
    label: "Duplicate nodes",
    description: "Duplicate the current selection with an optional offset.",
    supportedEditorTypes: ["figma"],
    requiresSelection: true,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "nodes.group",
    domain: "nodes",
    label: "Group nodes",
    description: "Group the current selection under the same parent.",
    supportedEditorTypes: ["figma"],
    requiresSelection: true,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "nodes.frame-selection",
    domain: "nodes",
    label: "Frame selection",
    description: "Wrap the current selection in a new frame.",
    supportedEditorTypes: ["figma"],
    requiresSelection: true,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "nodes.create-frame",
    domain: "nodes",
    label: "Create frame",
    description:
      "Create a new empty frame node on the current page or inside a specified parent.",
    supportedEditorTypes: ["figma"],
    requiresSelection: false,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "nodes.create-text",
    domain: "nodes",
    label: "Create text",
    description:
      "Create a new text node with specified content on the current page or inside a specified parent.",
    supportedEditorTypes: ["figma"],
    requiresSelection: false,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "nodes.create-rectangle",
    domain: "nodes",
    label: "Create rectangle",
    description: "Create a new rectangle node inside a specified parent.",
    supportedEditorTypes: ["figma"],
    requiresSelection: false,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "nodes.create-ellipse",
    domain: "nodes",
    label: "Create ellipse",
    description: "Create a new ellipse node inside a specified parent.",
    supportedEditorTypes: ["figma"],
    requiresSelection: false,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "nodes.create-line",
    domain: "nodes",
    label: "Create line",
    description: "Create a new line node inside a specified parent.",
    supportedEditorTypes: ["figma"],
    requiresSelection: false,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "nodes.create-svg",
    domain: "nodes",
    label: "Create SVG",
    description: "Create editable vector nodes from an SVG string inside a specified parent.",
    supportedEditorTypes: ["figma"],
    requiresSelection: false,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "assets.export-node-image",
    domain: "assets-images-export",
    label: "Export node image",
    description:
      "Export a node as a raster image and optionally prefer original image-fill bytes when available.",
    supportedEditorTypes: ["figma"],
    requiresSelection: false,
    requiresEditAccess: false,
    requiresPaidFeature: false,
  },
  {
    id: "reconstruction.apply-raster-reference",
    domain: "reconstruction",
    label: "Apply raster reference",
    description:
      "Replace a target frame's contents with a raster-exact reconstruction from a reference node.",
    supportedEditorTypes: ["figma"],
    requiresSelection: false,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "nodes.delete",
    domain: "nodes",
    label: "Delete nodes",
    description: "Delete the specified nodes from the document by nodeIds.",
    supportedEditorTypes: ["figma"],
    requiresSelection: false,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "text.set-content",
    domain: "text",
    label: "Set text content",
    description: "Replace the text content of the current selection.",
    supportedEditorTypes: ["figma"],
    requiresSelection: true,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "text.set-font-size",
    domain: "text",
    label: "Set font size",
    description: "Update the font size of the current selection.",
    supportedEditorTypes: ["figma"],
    requiresSelection: true,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "text.set-font-family",
    domain: "text",
    label: "Set font family",
    description: "Update the font family of the current selection.",
    supportedEditorTypes: ["figma"],
    requiresSelection: true,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "text.set-font-weight",
    domain: "text",
    label: "Set font weight",
    description: "Update the font weight of the current selection.",
    supportedEditorTypes: ["figma"],
    requiresSelection: true,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "text.set-text-color",
    domain: "text",
    label: "Set text color",
    description: "Update the text color of the current selection.",
    supportedEditorTypes: ["figma"],
    requiresSelection: true,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "text.set-line-height",
    domain: "text",
    label: "Set line height",
    description: "Update the line height of the current selection.",
    supportedEditorTypes: ["figma"],
    requiresSelection: true,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "text.set-letter-spacing",
    domain: "text",
    label: "Set letter spacing",
    description: "Update the letter spacing of the current selection.",
    supportedEditorTypes: ["figma"],
    requiresSelection: true,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "text.set-alignment",
    domain: "text",
    label: "Set text alignment",
    description: "Update the horizontal text alignment of the current selection.",
    supportedEditorTypes: ["figma"],
    requiresSelection: true,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "styles.upsert-text-style",
    domain: "styles",
    label: "Upsert text style",
    description: "Create or update a local text style.",
    supportedEditorTypes: ["figma"],
    requiresSelection: false,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "styles.apply-style",
    domain: "styles",
    label: "Apply style",
    description: "Apply a local paint or text style to the current selection.",
    supportedEditorTypes: ["figma"],
    requiresSelection: true,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
  {
    id: "styles.detach-style",
    domain: "styles",
    label: "Detach style",
    description: "Detach a fill, stroke, or text style from the current selection.",
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
  {
    id: "undo.undo-last",
    domain: "undo",
    label: "Undo last command",
    description: "Undo the last modifying command by restoring snapshotted properties.",
    supportedEditorTypes: ["figma"],
    requiresSelection: false,
    requiresEditAccess: true,
    requiresPaidFeature: false,
  },
];

export function getPluginCapabilityDescriptor(capabilityId: PluginCapabilityId) {
  return IMPLEMENTED_PLUGIN_CAPABILITIES.find((item) => item.id === capabilityId) || null;
}
