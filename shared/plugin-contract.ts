import type {
  PluginCapabilityId,
  PluginCapabilityPayloadMap,
  PluginExecutionMode,
} from "./plugin-capabilities.js";

export type LegacyFigmaPluginCommand =
  | {
      type: "refresh-selection";
    }
  | {
      type: "set-selection-fill";
      hex: string;
    }
  | {
      type: "set-selection-stroke";
      hex: string;
    }
  | {
      type: "set-selection-radius";
      value: number;
    }
  | {
      type: "set-selection-opacity";
      value: number;
    }
  | {
      type: "create-or-update-paint-style";
      name: string;
      hex: string;
      applyToSelection?: boolean;
    }
  | {
      type: "create-or-update-color-variable";
      collectionName: string;
      variableName: string;
      hex: string;
      bindToSelection?: boolean;
    };

export type FigmaCapabilityCommand<
  TCapabilityId extends PluginCapabilityId = PluginCapabilityId,
> = {
  type: "capability";
  capabilityId: TCapabilityId;
  payload: PluginCapabilityPayloadMap[TCapabilityId];
  executionMode?: PluginExecutionMode;
  dryRun?: boolean;
};

export type FigmaPluginCommand = LegacyFigmaPluginCommand | FigmaCapabilityCommand;

export type FigmaPluginCommandBatch = {
  source: "codex" | "user";
  requestId?: string;
  issuedAt?: string;
  commands: FigmaPluginCommand[];
};
