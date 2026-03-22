import type { FigmaCapabilityCommand, FigmaPluginCommandBatch } from "./plugin-contract.js";

export type PluginCommandComposition = {
  batch: FigmaPluginCommandBatch;
  notes: string[];
  warnings: string[];
};

function createRequestId() {
  return `plugin_req_${Math.random().toString(36).slice(2, 10)}`;
}

const namedColors: Array<[string, string]> = [
  ["亮粉", "#FF5FA2"],
  ["浅粉", "#F8A5C2"],
  ["粉色", "#FF6FAE"],
  ["粉红", "#FF6FAE"],
  ["红色", "#FF5A5F"],
  ["橙色", "#F28C28"],
  ["黄色", "#F4C542"],
  ["绿色", "#29B36A"],
  ["青色", "#22B8CF"],
  ["蓝色", "#3366FF"],
  ["紫色", "#7B61FF"],
  ["黑色", "#111111"],
  ["白色", "#FFFFFF"],
  ["灰色", "#9AA0A6"],
];

function normalizeHex(value: string) {
  const trimmed = value.trim().replace(/^#/, "");
  if (!/^[\da-fA-F]{3}$|^[\da-fA-F]{6}$/.test(trimmed)) {
    return null;
  }

  const expanded =
    trimmed.length === 3
      ? trimmed
          .split("")
          .map((char) => char + char)
          .join("")
      : trimmed;

  return `#${expanded.toUpperCase()}`;
}

function resolveColor(text: string) {
  const directHex = text.match(/#([\da-fA-F]{3}|[\da-fA-F]{6})\b/);
  if (directHex) {
    return normalizeHex(directHex[0]);
  }

  for (const [name, hex] of namedColors) {
    if (text.includes(name)) {
      return hex;
    }
  }

  return null;
}

function resolveNumber(text: string) {
  const matched = text.match(/-?\d+(\.\d+)?/);
  if (!matched) {
    return null;
  }

  return Number.parseFloat(matched[0]);
}

function parseVariableToken(text: string) {
  const match = text.match(/变量\s+([^\s#，。；;]+)/);
  if (!match) {
    return null;
  }

  const token = match[1];
  const slashIndex = token.indexOf("/");
  if (slashIndex < 0) {
    return null;
  }

  return {
    collectionName: token.slice(0, slashIndex),
    variableName: token.slice(slashIndex + 1),
  };
}

function parseStyleName(text: string) {
  const match = text.match(/样式\s+(.+?)(?=\s+#|$)/);
  if (!match) {
    return null;
  }

  return match[1].trim();
}

export function composePluginCommandsFromPrompt(prompt: string): PluginCommandComposition {
  const normalized = prompt.trim();
  const commands: FigmaCapabilityCommand[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];

  if (!normalized) {
    return {
      batch: { source: "user", commands: [] },
      notes,
      warnings: ["自然语言输入为空。"],
    };
  }

  const lines = normalized
    .split(/\n|；|;/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line.includes("刷新")) {
      commands.push({
        type: "capability",
        capabilityId: "selection.refresh",
        payload: {},
      });
      notes.push("已加入刷新 selection。");
      continue;
    }

    const variableTarget = parseVariableToken(line);
    const styleName = parseStyleName(line);
    const color = resolveColor(line);

    if ((line.includes("变量") || line.includes("variable")) && variableTarget && color) {
      commands.push({
        type: "capability",
        capabilityId: "variables.upsert-color-variable",
        payload: {
          collectionName: variableTarget.collectionName,
          variableName: variableTarget.variableName,
          hex: color,
          bindToSelection: line.includes("绑定") || line.includes("应用"),
        },
      });
      notes.push(`已生成变量命令：${variableTarget.collectionName}/${variableTarget.variableName}。`);
      continue;
    }

    if ((line.includes("样式") || line.includes("style")) && styleName && color) {
      commands.push({
        type: "capability",
        capabilityId: "styles.upsert-paint-style",
        payload: {
          name: styleName,
          hex: color,
          applyToSelection: line.includes("应用"),
        },
      });
      notes.push(`已生成样式命令：${styleName}。`);
      continue;
    }

    if (line.includes("描边") || line.toLowerCase().includes("stroke")) {
      if (color) {
        commands.push({
          type: "capability",
          capabilityId: "strokes.set-stroke",
          payload: { hex: color },
        });
        notes.push(`已生成描边颜色命令：${color}。`);
      } else {
        warnings.push(`无法从这句里识别描边颜色：${line}`);
      }
      continue;
    }

    if (line.includes("圆角") || line.toLowerCase().includes("radius")) {
      const value = resolveNumber(line);
      if (value !== null) {
        commands.push({
          type: "capability",
          capabilityId: "geometry.set-radius",
          payload: { value },
        });
        notes.push(`已生成圆角命令：${value}px。`);
      } else {
        warnings.push(`无法从这句里识别圆角数值：${line}`);
      }
      continue;
    }

    if (line.includes("透明度") || line.toLowerCase().includes("opacity")) {
      const value = resolveNumber(line);
      if (value !== null) {
        commands.push({
          type: "capability",
          capabilityId: "nodes.set-opacity",
          payload: { value },
        });
        notes.push(`已生成透明度命令：${value}%。`);
      } else {
        warnings.push(`无法从这句里识别透明度：${line}`);
      }
      continue;
    }

    if (
      line.includes("填充") ||
      line.includes("改成") ||
      line.toLowerCase().includes("fill") ||
      line.toLowerCase().includes("color")
    ) {
      if (color) {
        commands.push({
          type: "capability",
          capabilityId: "fills.set-fill",
          payload: { hex: color },
        });
        notes.push(`已生成填充颜色命令：${color}。`);
      } else {
        warnings.push(`无法从这句里识别填充颜色：${line}`);
      }
      continue;
    }

    warnings.push(`暂时无法解析这句：${line}`);
  }

  return {
    batch: {
      source: "user",
      requestId: createRequestId(),
      issuedAt: new Date().toISOString(),
      commands,
    },
    notes,
    warnings,
  };
}
