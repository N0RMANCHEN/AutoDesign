import type { PluginBridgeCommandRecord } from "./plugin-bridge.js";
import {
  buildRuntimeBridgeOverviewCommand,
  type RuntimeBridgeOverviewCommand,
} from "./runtime-bridge-overview.js";

export type RuntimeBridgeDispatchReceipt = {
  command: RuntimeBridgeOverviewCommand;
  payloadCommandCount: number;
};

export function buildRuntimeBridgeDispatchReceipt(
  command: PluginBridgeCommandRecord,
): RuntimeBridgeDispatchReceipt {
  return {
    command: buildRuntimeBridgeOverviewCommand(command),
    payloadCommandCount: Array.isArray(command.payload.commands)
      ? command.payload.commands.length
      : 0,
  };
}
