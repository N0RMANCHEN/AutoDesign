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
  ["深灰色", "#4A4F55"],
  ["深灰", "#4A4F55"],
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

function resolveNumbers(text: string) {
  return Array.from(text.matchAll(/-?\d+(\.\d+)?/g)).map((match) => Number.parseFloat(match[0]));
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

function parseQuotedValue(text: string) {
  const match = text.match(/[""'“”「」『』](.+?)[""'“”「」『』]/);
  return match ? match[1].trim() : null;
}

function parseFontFamily(text: string) {
  const quoted = parseQuotedValue(text);
  if (quoted) {
    return quoted;
  }

  const match = text.match(/(?:字体|font family)\s+([^\s，。；;]+)/i);
  return match ? match[1].trim() : null;
}

function parseTextValue(text: string) {
  const quoted = parseQuotedValue(text);
  if (quoted) {
    return quoted;
  }

  const match = text.match(/(?:文本|文字|content)\s*(?:改成|改为|设为|设置为|设置成)?\s*(.+)$/i);
  return match ? match[1].trim() : null;
}

function parseFontWeight(text: string) {
  if (text.includes("粗体")) {
    return "Bold";
  }
  if (text.includes("常规")) {
    return "Regular";
  }
  if (text.includes("细体")) {
    return "Light";
  }

  const value = resolveNumber(text);
  if (value !== null) {
    return value;
  }

  const match = text.match(/(?:字重|font weight)\s+([^\s，。；;]+)/i);
  return match ? match[1].trim() : null;
}

function parseTextAlignment(text: string) {
  if (text.includes("两端对齐")) {
    return "justified" as const;
  }
  if (text.includes("左对齐")) {
    return "left" as const;
  }
  if (text.includes("右对齐")) {
    return "right" as const;
  }
  if (text.includes("居中对齐") || text.includes("文本居中") || text.includes("文字居中")) {
    return "center" as const;
  }

  const normalized = text.toLowerCase();
  if (normalized.includes("align left")) {
    return "left" as const;
  }
  if (normalized.includes("align center")) {
    return "center" as const;
  }
  if (normalized.includes("align right")) {
    return "right" as const;
  }
  if (normalized.includes("justify")) {
    return "justified" as const;
  }

  return null;
}

function parseNamedStyleTarget(text: string, keyword: string) {
  const quoted = parseQuotedValue(text);
  if (quoted) {
    return quoted;
  }

  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`${escaped}\\s+([^\\s，。；;]+)`, "i"));
  return match ? match[1].trim() : null;
}

function parseExplicitName(text: string) {
  const quoted = parseQuotedValue(text);
  if (quoted) {
    return quoted;
  }

  const direct = text.match(/(?:重命名为|命名为|名字叫|名称为|叫做|分组为|编组为)\s*(.+)$/i);
  if (direct) {
    return direct[1].trim();
  }

  const shortName = text.match(/名字\s+(.+?)(?=\s+(?:padding|内边距)\b|$)/i);
  return shortName ? shortName[1].trim() : null;
}

function parseRectanglePlacement(text: string) {
  const normalized = text.toLowerCase();
  if (text.includes("下方") || text.includes("下面") || text.includes("下边") || normalized.includes("below")) {
    return "below" as const;
  }
  if (text.includes("上方") || text.includes("上面") || text.includes("上边") || normalized.includes("above")) {
    return "above" as const;
  }
  if (text.includes("左侧") || text.includes("左边") || normalized.includes("left of")) {
    return "left" as const;
  }
  if (text.includes("右侧") || text.includes("右边") || normalized.includes("right of")) {
    return "right" as const;
  }
  return null;
}

function parseRectangleSize(text: string) {
  const pair = text.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (pair) {
    return {
      width: Number.parseFloat(pair[1]),
      height: Number.parseFloat(pair[2]),
    };
  }

  const widthMatch = text.match(/(?:宽|width)\s*(\d+(?:\.\d+)?)/i);
  const heightMatch = text.match(/(?:高|height)\s*(\d+(?:\.\d+)?)/i);
  if (widthMatch && heightMatch) {
    return {
      width: Number.parseFloat(widthMatch[1]),
      height: Number.parseFloat(heightMatch[1]),
    };
  }

  if (text.includes("方块") || text.includes("正方形") || text.toLowerCase().includes("square")) {
    const prefixed = text.match(/(?:方块|正方形|square)\s*(\d+(?:\.\d+)?)/i);
    const suffixed = text.match(/(\d+(?:\.\d+)?)\s*(?:px)?\s*(?:方块|正方形|square)/i);
    const size = prefixed
      ? Number.parseFloat(prefixed[1])
      : suffixed
        ? Number.parseFloat(suffixed[1])
        : 80;
    return {
      width: size,
      height: size,
    };
  }

  if (text.includes("矩形") || text.toLowerCase().includes("rectangle")) {
    const values = resolveNumbers(text);
    if (values.length >= 2) {
      return {
        width: values[0],
        height: values[1],
      };
    }
    return {
      width: 120,
      height: 80,
    };
  }

  return null;
}

function parseGap(text: string) {
  const explicitGap = text.match(/(?:间距|gap|偏移)\s*(\d+(?:\.\d+)?)/i);
  if (explicitGap) {
    return Number.parseFloat(explicitGap[1]);
  }

  const placement = parseRectanglePlacement(text);
  if (!placement) {
    return undefined;
  }

  const values = resolveNumbers(text);
  if (!values.length) {
    return 16;
  }

  const size = parseRectangleSize(text);
  if (size) {
    if (values.length >= 3) {
      return values[2];
    }
    return 16;
  }

  return values[0] ?? 16;
}

function extractDrawingClause(text: string) {
  const match = text.match(/(画|创建|新建).*/i);
  return match ? match[0] : text;
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

    if (
      (line.includes("清空") || line.includes("去掉") || line.includes("删除")) &&
      (line.includes("填充") || line.toLowerCase().includes("fill"))
    ) {
      commands.push({
        type: "capability",
        capabilityId: "fills.clear-fill",
        payload: {},
      });
      notes.push("已生成清空填充命令。");
      continue;
    }

    if (
      (line.includes("清空") || line.includes("去掉") || line.includes("删除")) &&
      (line.includes("描边") || line.toLowerCase().includes("stroke") || line.includes("边框"))
    ) {
      commands.push({
        type: "capability",
        capabilityId: "strokes.clear-stroke",
        payload: {},
      });
      notes.push("已生成清空描边命令。");
      continue;
    }

    if (
      (line.includes("清空") || line.includes("去掉") || line.includes("删除")) &&
      (line.includes("效果") ||
        line.includes("阴影") ||
        line.includes("模糊") ||
        line.toLowerCase().includes("shadow") ||
        line.toLowerCase().includes("blur"))
    ) {
      commands.push({
        type: "capability",
        capabilityId: "effects.clear-effects",
        payload: {},
      });
      notes.push("已生成清空效果命令。");
      continue;
    }

    const variableTarget = parseVariableToken(line);
    const styleName = parseStyleName(line);
    const color = resolveColor(line);
    const values = resolveNumbers(line);
    const fontFamily = parseFontFamily(line);
    const explicitName = parseExplicitName(line);

    if (
      line.includes("重命名") ||
      line.includes("命名为") ||
      line.includes("名字叫") ||
      line.includes("名称为")
    ) {
      if (explicitName) {
        commands.push({
          type: "capability",
          capabilityId: "nodes.rename",
          payload: { name: explicitName },
        });
        notes.push(`已生成重命名命令：${explicitName}。`);
      } else {
        warnings.push(`无法从这句里识别目标名称：${line}`);
      }
      continue;
    }

    if (line.includes("复制")) {
      const [offsetX, offsetY] = values;
      commands.push({
        type: "capability",
        capabilityId: "nodes.duplicate",
        payload:
          offsetX !== undefined && offsetY !== undefined
            ? { offsetX, offsetY }
            : {},
      });
      if (offsetX !== undefined && offsetY !== undefined) {
        notes.push(`已生成复制命令，并偏移 (${offsetX}, ${offsetY})。`);
      } else {
        notes.push("已生成复制命令。");
      }
      continue;
    }

    if (
      line.includes("编组") ||
      (line.includes("分组") && !line.includes("样式"))
    ) {
      commands.push({
        type: "capability",
        capabilityId: "nodes.group",
        payload: explicitName ? { name: explicitName } : {},
      });
      notes.push(explicitName ? `已生成分组命令：${explicitName}。` : "已生成分组命令。");
      continue;
    }

    if (
      (line.includes("Frame") || line.includes("frame") || line.includes("框")) &&
      (line.includes("包") || line.includes("wrap"))
    ) {
      const padding = line.toLowerCase().includes("padding") || line.includes("内边距")
        ? values[0]
        : undefined;
      commands.push({
        type: "capability",
        capabilityId: "nodes.frame-selection",
        payload: {
          ...(explicitName ? { name: explicitName } : {}),
          ...(padding !== undefined ? { padding } : {}),
        },
      });
      notes.push(
        explicitName || padding !== undefined
          ? `已生成 Frame 包裹命令${explicitName ? `：${explicitName}` : ""}${padding !== undefined ? `，padding ${padding}` : ""}。`
          : "已生成 Frame 包裹命令。",
      );
      continue;
    }

    if (
      (line.includes("画") || line.includes("创建") || line.includes("新建")) &&
      (line.includes("方块") || line.includes("正方形") || line.includes("矩形") || line.toLowerCase().includes("square") || line.toLowerCase().includes("rectangle"))
    ) {
      const size = parseRectangleSize(line);
      if (!size) {
        warnings.push(`无法从这句里识别矩形尺寸：${line}`);
        continue;
      }

      const placement = parseRectanglePlacement(line);
      const gap = parseGap(line);
      const fillHex = resolveColor(extractDrawingClause(line)) || "#D9D9D9";
      commands.push({
        type: "capability",
        capabilityId: "nodes.create-rectangle",
        payload: {
          width: size.width,
          height: size.height,
          fillHex,
          ...(explicitName ? { name: explicitName } : {}),
          ...(placement ? { placement } : {}),
          ...(gap !== undefined ? { gap } : {}),
        },
      });
      notes.push(
        `已生成矩形创建命令：${size.width}x${size.height}${placement ? `，${placement} gap ${gap ?? 16}` : ""}，fill ${fillHex}。`,
      );
      continue;
    }

    if (
      line.includes("描边") ||
      line.toLowerCase().includes("stroke") ||
      line.includes("边框")
    ) {
      const isWeightIntent =
        line.includes("粗细") ||
        line.includes("宽度") ||
        line.includes("weight") ||
        line.includes("thickness");
      if (isWeightIntent) {
        const value = resolveNumber(line);
        if (value !== null) {
          commands.push({
            type: "capability",
            capabilityId: "strokes.set-weight",
            payload: { value },
          });
          notes.push(`已生成描边粗细命令：${value}px。`);
        } else {
          warnings.push(`无法从这句里识别描边粗细：${line}`);
        }
        continue;
      }
    }

    if (line.includes("阴影") || line.toLowerCase().includes("shadow")) {
      const [offsetX = 0, offsetY = 4, blur = 16] = values;
      commands.push({
        type: "capability",
        capabilityId: "effects.set-shadow",
        payload: {
          offsetX,
          offsetY,
          blur,
          colorHex: color || "#000000",
        },
      });
      notes.push(`已生成阴影命令：offset(${offsetX}, ${offsetY}) blur ${blur}。`);
      continue;
    }

    if (line.includes("模糊") || line.toLowerCase().includes("blur")) {
      const radius = values[0];
      if (radius !== undefined) {
        commands.push({
          type: "capability",
          capabilityId: "effects.set-layer-blur",
          payload: { radius },
        });
        notes.push(`已生成图层模糊命令：${radius}px。`);
      } else {
        warnings.push(`无法从这句里识别模糊半径：${line}`);
      }
      continue;
    }

    if (
      line.includes("尺寸") ||
      line.includes("大小") ||
      line.includes("宽高") ||
      line.toLowerCase().includes("size")
    ) {
      if (values.length >= 2) {
        commands.push({
          type: "capability",
          capabilityId: "geometry.set-size",
          payload: {
            width: values[0],
            height: values[1],
          },
        });
        notes.push(`已生成尺寸命令：${values[0]} x ${values[1]}。`);
      } else {
        warnings.push(`无法从这句里识别宽高：${line}`);
      }
      continue;
    }

    if (
      line.includes("位置") ||
      line.includes("坐标") ||
      line.toLowerCase().includes("position") ||
      line.toLowerCase().includes("move to")
    ) {
      if (values.length >= 2) {
        commands.push({
          type: "capability",
          capabilityId: "geometry.set-position",
          payload: {
            x: values[0],
            y: values[1],
          },
        });
        notes.push(`已生成位置命令：(${values[0]}, ${values[1]})。`);
      } else {
        warnings.push(`无法从这句里识别位置坐标：${line}`);
      }
      continue;
    }

    if (
      (line.includes("解绑") || line.includes("移除")) &&
      (line.includes("样式") || line.toLowerCase().includes("style"))
    ) {
      const styleType = line.includes("文字") || line.includes("文本")
        ? "text"
        : line.includes("描边")
          ? "stroke"
          : "fill";
      commands.push({
        type: "capability",
        capabilityId: "styles.detach-style",
        payload: { styleType },
      });
      notes.push(`已生成解绑样式命令：${styleType}。`);
      continue;
    }

    if (
      (line.includes("应用") || line.toLowerCase().includes("apply")) &&
      (line.includes("样式") || line.toLowerCase().includes("style"))
    ) {
      const styleType = line.includes("文字") || line.includes("文本") ? "text" : "paint";
      const targetName =
        styleType === "text"
          ? parseNamedStyleTarget(line, "文字样式") || parseNamedStyleTarget(line, "文本样式")
          : parseNamedStyleTarget(line, "样式");
      if (targetName) {
        commands.push({
          type: "capability",
          capabilityId: "styles.apply-style",
          payload: {
            styleType,
            styleName: targetName,
          },
        });
        notes.push(`已生成样式应用命令：${targetName}。`);
      } else {
        warnings.push(`无法从这句里识别要应用的样式名：${line}`);
      }
      continue;
    }

    if (
      (line.includes("文字样式") || line.includes("文本样式") || line.toLowerCase().includes("text style")) &&
      (line.includes("创建") || line.includes("更新") || line.includes("新建") || line.toLowerCase().includes("style"))
    ) {
      const targetName =
        parseNamedStyleTarget(line, "文字样式") ||
        parseNamedStyleTarget(line, "文本样式") ||
        parseNamedStyleTarget(line, "text style");
      const fontSize = values[0];
      if (targetName && fontFamily && fontSize !== undefined) {
        commands.push({
          type: "capability",
          capabilityId: "styles.upsert-text-style",
          payload: {
            name: targetName,
            fontFamily,
            fontSize,
            textColorHex: color || undefined,
          },
        });
        notes.push(`已生成文字样式命令：${targetName}。`);
      } else {
        warnings.push(`文字样式命令至少需要样式名、字体和字号：${line}`);
      }
      continue;
    }

    if (
      line.includes("文字颜色") ||
      line.includes("文本颜色") ||
      line.includes("字体颜色") ||
      line.toLowerCase().includes("text color")
    ) {
      if (color) {
        commands.push({
          type: "capability",
          capabilityId: "text.set-text-color",
          payload: { hex: color },
        });
        notes.push(`已生成文字颜色命令：${color}。`);
      } else {
        warnings.push(`无法从这句里识别文字颜色：${line}`);
      }
      continue;
    }

    if (line.includes("字号") || line.toLowerCase().includes("font size")) {
      const value = resolveNumber(line);
      if (value !== null) {
        commands.push({
          type: "capability",
          capabilityId: "text.set-font-size",
          payload: { value },
        });
        notes.push(`已生成字号命令：${value}px。`);
      } else {
        warnings.push(`无法从这句里识别字号：${line}`);
      }
      continue;
    }

    if (line.includes("行高") || line.toLowerCase().includes("line height")) {
      const value = resolveNumber(line);
      if (value !== null) {
        commands.push({
          type: "capability",
          capabilityId: "text.set-line-height",
          payload: { value },
        });
        notes.push(`已生成行高命令：${value}px。`);
      } else {
        warnings.push(`无法从这句里识别行高：${line}`);
      }
      continue;
    }

    if (
      line.includes("字距") ||
      line.includes("字间距") ||
      line.toLowerCase().includes("letter spacing")
    ) {
      const value = resolveNumber(line);
      if (value !== null) {
        commands.push({
          type: "capability",
          capabilityId: "text.set-letter-spacing",
          payload: { value },
        });
        notes.push(`已生成字距命令：${value}px。`);
      } else {
        warnings.push(`无法从这句里识别字距：${line}`);
      }
      continue;
    }

    const alignment = parseTextAlignment(line);
    if (alignment) {
      commands.push({
        type: "capability",
        capabilityId: "text.set-alignment",
        payload: { value: alignment },
      });
      notes.push(`已生成文本对齐命令：${alignment}。`);
      continue;
    }

    if (line.includes("字体") || line.toLowerCase().includes("font family")) {
      if (fontFamily) {
        commands.push({
          type: "capability",
          capabilityId: "text.set-font-family",
          payload: { family: fontFamily },
        });
        notes.push(`已生成字体命令：${fontFamily}。`);
      } else {
        warnings.push(`无法从这句里识别字体：${line}`);
      }
      continue;
    }

    if (line.includes("字重") || line.includes("粗体") || line.toLowerCase().includes("font weight")) {
      const value = parseFontWeight(line);
      if (value !== null) {
        commands.push({
          type: "capability",
          capabilityId: "text.set-font-weight",
          payload: { value },
        });
        notes.push(`已生成字重命令：${value}。`);
      } else {
        warnings.push(`无法从这句里识别字重：${line}`);
      }
      continue;
    }

    if (line.includes("文本") || line.includes("文字") || line.toLowerCase().includes("content")) {
      const value = parseTextValue(line);
      if (value) {
        commands.push({
          type: "capability",
          capabilityId: "text.set-content",
          payload: { value },
        });
        notes.push(`已生成文本内容命令：${value}。`);
      } else {
        warnings.push(`无法从这句里识别文本内容：${line}`);
      }
      continue;
    }

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
