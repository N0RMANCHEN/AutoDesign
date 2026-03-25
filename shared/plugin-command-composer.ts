import type { FigmaCapabilityCommand, FigmaPluginCommandBatch } from "./plugin-contract.js";
import {
  extractDrawingClause,
  parseExplicitName,
  parseFontFamily,
  parseFontWeight,
  parseGap,
  parseNamedStyleTarget,
  parseRectanglePlacement,
  parseRectangleSize,
  parseStyleName,
  parseTextAlignment,
  parseTextValue,
  parseVariableToken,
  resolveColor,
  resolveNumber,
  resolveNumbers,
} from "./plugin-command-composer-parsers.js";

export type PluginCommandComposition = {
  batch: FigmaPluginCommandBatch;
  notes: string[];
  warnings: string[];
};

function createRequestId() {
  return `plugin_req_${Math.random().toString(36).slice(2, 10)}`;
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
