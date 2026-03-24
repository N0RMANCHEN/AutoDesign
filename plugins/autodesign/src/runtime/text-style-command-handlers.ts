import type { PluginCommandExecutionResult } from "../../../../shared/plugin-bridge.js";
import type { FigmaCapabilityCommand } from "../../../../shared/plugin-contract.js";

import { normalizeHex } from "./selection-context.js";
import {
  applyPaintStyleToNode,
  applyTextStyleToNode,
  detachStyleFromNode,
  setTextAlignment,
  setTextColor,
  setTextContent,
  setTextFontFamily,
  setTextFontSize,
  setTextFontWeight,
  setTextLetterSpacing,
  setTextLineHeight,
  upsertColorVariable,
  upsertPaintStyle,
  upsertTextStyle,
} from "./text-style-helpers.js";

type SuccessResultFactory = (
  capabilityId: FigmaCapabilityCommand["capabilityId"],
  message: string,
  details?: Partial<Omit<PluginCommandExecutionResult, "capabilityId" | "ok" | "message">>,
) => PluginCommandExecutionResult;

type TextStyleCommandDeps = {
  getTargetNodes: (command: FigmaCapabilityCommand, batchSource?: string) => Promise<any[]>;
  successResult: SuccessResultFactory;
};

export async function tryRunTextStyleCommand(
  command: FigmaCapabilityCommand,
  batchSource: string | undefined,
  deps: TextStyleCommandDeps,
): Promise<PluginCommandExecutionResult | null> {
  switch (command.capabilityId) {
    case "text.set-content": {
      const payload = command.payload as { value: string };
      if (!String(payload.value || "").length) {
        throw new Error("文本内容不能为空。");
      }

      const changedNodeIds: string[] = [];
      const warnings: string[] = [];
      for (const node of await deps.getTargetNodes(command, batchSource)) {
        try {
          if (await setTextContent(node, payload.value)) {
            changedNodeIds.push(node.id);
          }
        } catch (error) {
          warnings.push(`${node.name || node.id}: ${error instanceof Error ? error.message : "未知错误"}`);
        }
      }

      if (!changedNodeIds.length) {
        throw new Error(warnings[0] || "当前 selection 中没有可改文字内容的文本节点。");
      }

      return deps.successResult(command.capabilityId, `已更新 ${changedNodeIds.length} 个文本节点的内容。`, {
        changedNodeIds,
        warnings,
      });
    }

    case "text.set-font-size": {
      const payload = command.payload as { value: number };
      if (!Number.isFinite(payload.value) || payload.value <= 0) {
        throw new Error("字号必须是大于 0 的数字。");
      }

      const changedNodeIds: string[] = [];
      const warnings: string[] = [];
      for (const node of await deps.getTargetNodes(command, batchSource)) {
        try {
          if (await setTextFontSize(node, payload.value)) {
            changedNodeIds.push(node.id);
          }
        } catch (error) {
          warnings.push(`${node.name || node.id}: ${error instanceof Error ? error.message : "未知错误"}`);
        }
      }

      if (!changedNodeIds.length) {
        throw new Error(warnings[0] || "当前 selection 中没有可改字号的文本节点。");
      }

      return deps.successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个文本节点的字号设为 ${payload.value}px。`,
        {
          changedNodeIds,
          warnings,
        },
      );
    }

    case "text.set-font-family": {
      const payload = command.payload as { family: string; style?: string };
      if (!String(payload.family || "").trim()) {
        throw new Error("字体族不能为空。");
      }

      const changedNodeIds: string[] = [];
      const warnings: string[] = [];
      for (const node of await deps.getTargetNodes(command, batchSource)) {
        try {
          if (await setTextFontFamily(node, payload.family.trim(), payload.style?.trim())) {
            changedNodeIds.push(node.id);
          }
        } catch (error) {
          warnings.push(`${node.name || node.id}: ${error instanceof Error ? error.message : "未知错误"}`);
        }
      }

      if (!changedNodeIds.length) {
        throw new Error(warnings[0] || "当前 selection 中没有可改字体族的文本节点。");
      }

      return deps.successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个文本节点的字体改为 ${payload.family.trim()}。`,
        {
          changedNodeIds,
          warnings,
        },
      );
    }

    case "text.set-font-weight": {
      const payload = command.payload as { value: number | string };
      if (payload.value === undefined || payload.value === null || `${payload.value}`.trim() === "") {
        throw new Error("字重不能为空。");
      }

      const changedNodeIds: string[] = [];
      const warnings: string[] = [];
      for (const node of await deps.getTargetNodes(command, batchSource)) {
        try {
          if (await setTextFontWeight(node, payload.value)) {
            changedNodeIds.push(node.id);
          }
        } catch (error) {
          warnings.push(`${node.name || node.id}: ${error instanceof Error ? error.message : "未知错误"}`);
        }
      }

      if (!changedNodeIds.length) {
        throw new Error(warnings[0] || "当前 selection 中没有可改字重的文本节点。");
      }

      return deps.successResult(
        command.capabilityId,
        `已更新 ${changedNodeIds.length} 个文本节点的字重。`,
        {
          changedNodeIds,
          warnings,
        },
      );
    }

    case "text.set-text-color": {
      const payload = command.payload as { hex: string };
      const changedNodeIds: string[] = [];
      for (const node of await deps.getTargetNodes(command, batchSource)) {
        try {
          if (setTextColor(node, payload.hex)) {
            changedNodeIds.push(node.id);
          }
        } catch {
          // Ignore non-editable overrides.
        }
      }

      if (!changedNodeIds.length) {
        throw new Error("当前 selection 中没有可改文字颜色的文本节点。");
      }

      return deps.successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个文本节点的颜色改为 ${normalizeHex(payload.hex)}。`,
        {
          changedNodeIds,
        },
      );
    }

    case "text.set-line-height": {
      const payload = command.payload as { value: number };
      if (!Number.isFinite(payload.value) || payload.value <= 0) {
        throw new Error("行高必须是大于 0 的数字。");
      }

      const changedNodeIds: string[] = [];
      const warnings: string[] = [];
      for (const node of await deps.getTargetNodes(command, batchSource)) {
        try {
          if (await setTextLineHeight(node, payload.value)) {
            changedNodeIds.push(node.id);
          }
        } catch (error) {
          warnings.push(`${node.name || node.id}: ${error instanceof Error ? error.message : "未知错误"}`);
        }
      }

      if (!changedNodeIds.length) {
        throw new Error(warnings[0] || "当前 selection 中没有可改行高的文本节点。");
      }

      return deps.successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个文本节点的行高设为 ${payload.value}px。`,
        {
          changedNodeIds,
          warnings,
        },
      );
    }

    case "text.set-letter-spacing": {
      const payload = command.payload as { value: number };
      if (!Number.isFinite(payload.value)) {
        throw new Error("字距必须是有效数字。");
      }

      const changedNodeIds: string[] = [];
      const warnings: string[] = [];
      for (const node of await deps.getTargetNodes(command, batchSource)) {
        try {
          if (await setTextLetterSpacing(node, payload.value)) {
            changedNodeIds.push(node.id);
          }
        } catch (error) {
          warnings.push(`${node.name || node.id}: ${error instanceof Error ? error.message : "未知错误"}`);
        }
      }

      if (!changedNodeIds.length) {
        throw new Error(warnings[0] || "当前 selection 中没有可改字距的文本节点。");
      }

      return deps.successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个文本节点的字距设为 ${payload.value}px。`,
        {
          changedNodeIds,
          warnings,
        },
      );
    }

    case "text.set-alignment": {
      const payload = command.payload as { value: "left" | "center" | "right" | "justified" };
      const changedNodeIds: string[] = [];
      const warnings: string[] = [];
      for (const node of await deps.getTargetNodes(command, batchSource)) {
        try {
          if (setTextAlignment(node, payload.value)) {
            changedNodeIds.push(node.id);
          }
        } catch (error) {
          warnings.push(`${node.name || node.id}: ${error instanceof Error ? error.message : "未知错误"}`);
        }
      }

      if (!changedNodeIds.length) {
        throw new Error(warnings[0] || "当前 selection 中没有可改对齐的文本节点。");
      }

      return deps.successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个文本节点设为 ${payload.value} 对齐。`,
        {
          changedNodeIds,
          warnings,
        },
      );
    }

    case "styles.upsert-text-style": {
      const payload = command.payload as {
        name: string;
        fontFamily: string;
        fontStyle?: string;
        fontSize: number;
        textColorHex?: string;
      };
      if (!String(payload.name || "").trim()) {
        throw new Error("text style 名称不能为空。");
      }
      if (!String(payload.fontFamily || "").trim()) {
        throw new Error("text style 字体族不能为空。");
      }
      if (!Number.isFinite(payload.fontSize) || payload.fontSize <= 0) {
        throw new Error("text style 字号必须是大于 0 的数字。");
      }

      const result = await upsertTextStyle(
        payload.name.trim(),
        payload.fontFamily.trim(),
        payload.fontSize,
        payload.fontStyle?.trim(),
        payload.textColorHex,
      );

      return deps.successResult(command.capabilityId, `已更新本地文字样式 ${result.style.name}。`, {
        createdStyleIds: [result.style.id],
      });
    }

    case "styles.apply-style": {
      const payload = command.payload as {
        styleType: "paint" | "text";
        styleName: string;
      };
      if (!String(payload.styleName || "").trim()) {
        throw new Error("要应用的样式名称不能为空。");
      }

      const changedNodeIds: string[] = [];
      if (payload.styleType === "paint") {
        const localStyles = await figma.getLocalPaintStylesAsync();
        const style = localStyles.find((item: any) => item.name === payload.styleName);
        if (!style) {
          throw new Error(`未找到本地 paint style: ${payload.styleName}`);
        }

        for (const node of await deps.getTargetNodes(command, batchSource)) {
          try {
            if (applyPaintStyleToNode(node, style.id)) {
              changedNodeIds.push(node.id);
            }
          } catch {
            // Ignore non-editable overrides.
          }
        }
      } else {
        const localStyles = await figma.getLocalTextStylesAsync();
        const style = localStyles.find((item: any) => item.name === payload.styleName);
        if (!style) {
          throw new Error(`未找到本地 text style: ${payload.styleName}`);
        }

        for (const node of await deps.getTargetNodes(command, batchSource)) {
          try {
            if (applyTextStyleToNode(node, style.id)) {
              changedNodeIds.push(node.id);
            }
          } catch {
            // Ignore non-editable overrides.
          }
        }
      }

      if (!changedNodeIds.length) {
        throw new Error("当前 selection 中没有可应用该样式的节点。");
      }

      return deps.successResult(
        command.capabilityId,
        `已将样式 ${payload.styleName} 应用到 ${changedNodeIds.length} 个节点。`,
        {
          changedNodeIds,
        },
      );
    }

    case "styles.detach-style": {
      const payload = command.payload as {
        styleType: "fill" | "stroke" | "text";
      };
      const changedNodeIds: string[] = [];
      for (const node of await deps.getTargetNodes(command, batchSource)) {
        try {
          if (detachStyleFromNode(node, payload.styleType)) {
            changedNodeIds.push(node.id);
          }
        } catch {
          // Ignore non-editable overrides.
        }
      }

      if (!changedNodeIds.length) {
        throw new Error("当前 selection 中没有可解绑该样式的节点。");
      }

      return deps.successResult(
        command.capabilityId,
        `已从 ${changedNodeIds.length} 个节点解绑 ${payload.styleType} style。`,
        {
          changedNodeIds,
        },
      );
    }

    case "styles.upsert-paint-style": {
      const payload = command.payload as {
        name: string;
        hex: string;
        applyToSelection?: boolean;
      };
      const result = await upsertPaintStyle(
        payload.name,
        payload.hex,
        Boolean(payload.applyToSelection),
      );

      return deps.successResult(
        command.capabilityId,
        payload.applyToSelection
          ? `已更新本地样式 ${result.style.name}，并应用到 ${result.changedNodeIds.length} 个节点。`
          : `已更新本地样式 ${result.style.name}。`,
        {
          changedNodeIds: result.changedNodeIds,
          createdStyleIds: [result.style.id],
          warnings: result.warnings,
        },
      );
    }

    case "variables.upsert-color-variable": {
      const payload = command.payload as {
        collectionName: string;
        variableName: string;
        hex: string;
        bindToSelection?: boolean;
      };
      const result = await upsertColorVariable(
        payload.collectionName,
        payload.variableName,
        payload.hex,
        Boolean(payload.bindToSelection),
      );

      return deps.successResult(
        command.capabilityId,
        payload.bindToSelection
          ? `已更新变量 ${result.collection.name}/${result.variable.name}，并绑定到 ${result.changedNodeIds.length} 个节点。`
          : `已更新变量 ${result.collection.name}/${result.variable.name}。`,
        {
          changedNodeIds: result.changedNodeIds,
          createdVariableIds: [result.variable.id],
          warnings: result.warnings,
        },
      );
    }

    default:
      return null;
  }
}
