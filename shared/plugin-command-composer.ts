import type { FigmaCapabilityCommand, FigmaPluginCommandBatch } from "./plugin-contract.js";
import {
  extractDrawingClause,
  parseColorAfterKeyword,
  parseExplicitName,
  parseFontFamily,
  parseFontWeight,
  parseGap,
  parseNamedStyleTarget,
  parseNumberAfterKeyword,
  parseNumberPairAfterKeyword,
  parseRectanglePlacement,
  parseRectangleSize,
  parseStyleName,
  parseTextAlignment,
  parseTextValue,
  parseVariableToken,
  resolveColor,
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

    const variableTarget = parseVariableToken(line);
    const styleName = parseStyleName(line);
    const color = resolveColor(line);
    const values = resolveNumbers(line);
    const fontFamily = parseFontFamily(line);
    const explicitName = parseExplicitName(line);
    const fillColor = parseColorAfterKeyword(line, "填充|fill");
    const strokeColor = parseColorAfterKeyword(line, "描边|stroke|边框");
    const shadowColor = parseColorAfterKeyword(line, "阴影|shadow");
    const textColor = parseColorAfterKeyword(line, "文字颜色|文本颜色|字体颜色|text color");
    const warningsBeforeLine = warnings.length;
    const hasClearIntent = line.includes("清空") || line.includes("去掉") || line.includes("删除");
    const hasClearFillIntent = hasClearIntent && (line.includes("填充") || line.toLowerCase().includes("fill"));
    const hasClearStrokeIntent =
      hasClearIntent && (line.includes("描边") || line.toLowerCase().includes("stroke") || line.includes("边框"));
    const hasClearEffectsIntent =
      hasClearIntent &&
      (line.includes("效果") ||
        line.includes("阴影") ||
        line.includes("模糊") ||
        line.toLowerCase().includes("shadow") ||
        line.toLowerCase().includes("blur"));

    if (hasClearFillIntent || hasClearStrokeIntent || hasClearEffectsIntent) {
      if (hasClearFillIntent) {
        commands.push({
          type: "capability",
          capabilityId: "fills.clear-fill",
          payload: {},
        });
        notes.push("已生成清空填充命令。");
      }
      if (hasClearStrokeIntent) {
        commands.push({
          type: "capability",
          capabilityId: "strokes.clear-stroke",
          payload: {},
        });
        notes.push("已生成清空描边命令。");
      }
      if (hasClearEffectsIntent) {
        commands.push({
          type: "capability",
          capabilityId: "effects.clear-effects",
          payload: {},
        });
        notes.push("已生成清空效果命令。");
      }
      continue;
    }

    const hasRenameIntent =
      line.includes("重命名") ||
      line.includes("命名为") ||
      line.includes("名字叫") ||
      line.includes("名称为") ||
      line.includes("名字改成") ||
      line.includes("名字改为") ||
      line.includes("名称改成") ||
      line.includes("名称改为") ||
      line.includes("名字设为") ||
      line.includes("名称设为");
    const hasDuplicateIntent = line.includes("复制");
    const hasExplicitStyleApplyPhrase =
      line.includes("应用样式") ||
      line.includes("应用文字样式") ||
      line.includes("应用文本样式") ||
      line.toLowerCase().includes("apply style");
    const hasTextStyleUpsertIntent =
      (line.includes("文字样式") || line.includes("文本样式") || line.toLowerCase().includes("text style")) &&
      (line.includes("创建") || line.includes("更新") || line.includes("新建") || line.toLowerCase().includes("style"));
    const hasPaintStyleUpsertIntent =
      !hasTextStyleUpsertIntent &&
      !hasExplicitStyleApplyPhrase &&
      (line.includes("样式") || line.toLowerCase().includes("style")) &&
      Boolean(styleName && color);
    const hasStyleDetachIntent =
      (line.includes("解绑") || line.includes("移除")) &&
      (line.includes("样式") || line.toLowerCase().includes("style"));
    const hasStyleApplyIntent =
      (line.includes("应用") || line.toLowerCase().includes("apply")) &&
      (line.includes("样式") || line.toLowerCase().includes("style")) &&
      !hasTextStyleUpsertIntent &&
      !hasPaintStyleUpsertIntent;
    const hasStrokeIntent =
      line.includes("描边") || line.toLowerCase().includes("stroke") || line.includes("边框");
    const hasStrokeWeightIntent =
      hasStrokeIntent &&
      (line.includes("粗细") ||
        line.includes("宽度") ||
        line.includes("weight") ||
        line.includes("thickness"));
    const hasStrokeColorIntent = hasStrokeIntent && Boolean(strokeColor || color);
    const hasShadowIntent = line.includes("阴影") || line.toLowerCase().includes("shadow");
    const hasLayerBlurIntent = line.includes("模糊") || line.toLowerCase().includes("blur");
    const hasSizeIntent =
      line.includes("尺寸") ||
      line.includes("大小") ||
      line.includes("宽高") ||
      line.toLowerCase().includes("size");
    const hasPositionIntent =
      line.includes("位置") ||
      line.includes("坐标") ||
      line.toLowerCase().includes("position") ||
      line.toLowerCase().includes("move to");
    const hasTextColorIntent =
      line.includes("文字颜色") ||
      line.includes("文本颜色") ||
      line.includes("字体颜色") ||
      line.toLowerCase().includes("text color");
    const hasFontSizeIntent = line.includes("字号") || line.toLowerCase().includes("font size");
    const hasLineHeightIntent = line.includes("行高") || line.toLowerCase().includes("line height");
    const hasLetterSpacingIntent =
      line.includes("字距") ||
      line.includes("字间距") ||
      line.toLowerCase().includes("letter spacing");
    const hasAlignmentIntent = parseTextAlignment(line);
    const hasFontFamilyIntent = line.includes("字体") || line.toLowerCase().includes("font family");
    const hasFontWeightIntent =
      line.includes("字重") || line.includes("粗体") || line.toLowerCase().includes("font weight");
    const hasTextContentIntent =
      (line.includes("文本") || line.includes("文字") || line.toLowerCase().includes("content")) &&
      !hasTextColorIntent &&
      !line.includes("文字样式") &&
      !line.includes("文本样式") &&
      !line.toLowerCase().includes("text style");
    const hasRadiusIntent = line.includes("圆角") || line.toLowerCase().includes("radius");
    const hasOpacityIntent = line.includes("透明度") || line.toLowerCase().includes("opacity");
    const hasFillIntent =
      line.includes("填充") ||
      line.toLowerCase().includes("fill") ||
      (line.toLowerCase().includes("color") && !hasTextColorIntent) ||
      (line.includes("改成") && !hasRenameIntent && !hasTextContentIntent && Boolean(color));
    let matchedDeferredMutation = false;

    if (hasRenameIntent || hasDuplicateIntent) {
      let matchedNodeMutation = false;
      if (hasDuplicateIntent) {
        const [offsetX, offsetY] = values;
        commands.push({
          type: "capability",
          capabilityId: "nodes.duplicate",
          payload:
            offsetX !== undefined && offsetY !== undefined
              ? { offsetX, offsetY }
              : {},
        });
        notes.push(
          offsetX !== undefined && offsetY !== undefined
            ? `已生成复制命令，并偏移 (${offsetX}, ${offsetY})。`
            : "已生成复制命令。",
        );
        matchedNodeMutation = true;
      }
      if (hasRenameIntent) {
        if (explicitName) {
          commands.push({
            type: "capability",
            capabilityId: "nodes.rename",
            payload: { name: explicitName },
          });
          notes.push(`已生成重命名命令：${explicitName}。`);
          matchedNodeMutation = true;
        } else {
          warnings.push(`无法从这句里识别目标名称：${line}`);
        }
      }
      if (matchedNodeMutation) {
        matchedDeferredMutation = true;
      }
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
      matchedDeferredMutation = true;
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
      matchedDeferredMutation = true;
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

    if (hasSizeIntent || hasPositionIntent) {
      let matchedGeometryMutation = false;
      if (hasSizeIntent) {
        const sizePair =
          parseNumberPairAfterKeyword(line, "尺寸|大小|宽高|size") ||
          (values.length >= 2 ? ([values[0], values[1]] as const) : null);
        if (sizePair) {
          commands.push({
            type: "capability",
            capabilityId: "geometry.set-size",
            payload: {
              width: sizePair[0],
              height: sizePair[1],
            },
          });
          notes.push(`已生成尺寸命令：${sizePair[0]} x ${sizePair[1]}。`);
          matchedGeometryMutation = true;
        } else {
          warnings.push(`无法从这句里识别宽高：${line}`);
        }
      }
      if (hasPositionIntent) {
        const positionPair =
          parseNumberPairAfterKeyword(line, "位置|坐标|position|move to") ||
          (values.length >= 2 ? ([values[0], values[1]] as const) : null);
        if (positionPair) {
          commands.push({
            type: "capability",
            capabilityId: "geometry.set-position",
            payload: {
              x: positionPair[0],
              y: positionPair[1],
            },
          });
          notes.push(`已生成位置命令：(${positionPair[0]}, ${positionPair[1]})。`);
          matchedGeometryMutation = true;
        } else {
          warnings.push(`无法从这句里识别位置坐标：${line}`);
        }
      }
      if (matchedGeometryMutation) {
        matchedDeferredMutation = true;
      }
    }

    if (hasStyleDetachIntent) {
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
      matchedDeferredMutation = true;
    }

    if (hasStyleApplyIntent) {
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
        matchedDeferredMutation = true;
      } else {
        warnings.push(`无法从这句里识别要应用的样式名：${line}`);
      }
    }

    if (hasTextStyleUpsertIntent) {
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
      hasTextColorIntent ||
      hasFontSizeIntent ||
      hasLineHeightIntent ||
      hasLetterSpacingIntent ||
      hasAlignmentIntent ||
      hasFontFamilyIntent ||
      hasFontWeightIntent ||
      hasTextContentIntent
    ) {
      let matchedTextMutation = false;

      if (hasTextContentIntent) {
        const value = parseTextValue(line);
        if (value) {
          commands.push({
            type: "capability",
            capabilityId: "text.set-content",
            payload: { value },
          });
          notes.push(`已生成文本内容命令：${value}。`);
          matchedTextMutation = true;
        } else {
          warnings.push(`无法从这句里识别文本内容：${line}`);
        }
      }

      if (hasTextColorIntent) {
        const hex = textColor || color;
        if (hex) {
          commands.push({
            type: "capability",
            capabilityId: "text.set-text-color",
            payload: { hex },
          });
          notes.push(`已生成文字颜色命令：${hex}。`);
          matchedTextMutation = true;
        } else {
          warnings.push(`无法从这句里识别文字颜色：${line}`);
        }
      }

      if (hasFontSizeIntent) {
        const value = parseNumberAfterKeyword(line, "字号|font size");
        if (value !== null) {
          commands.push({
            type: "capability",
            capabilityId: "text.set-font-size",
            payload: { value },
          });
          notes.push(`已生成字号命令：${value}px。`);
          matchedTextMutation = true;
        } else {
          warnings.push(`无法从这句里识别字号：${line}`);
        }
      }

      if (hasLineHeightIntent) {
        const value = parseNumberAfterKeyword(line, "行高|line height");
        if (value !== null) {
          commands.push({
            type: "capability",
            capabilityId: "text.set-line-height",
            payload: { value },
          });
          notes.push(`已生成行高命令：${value}px。`);
          matchedTextMutation = true;
        } else {
          warnings.push(`无法从这句里识别行高：${line}`);
        }
      }

      if (hasLetterSpacingIntent) {
        const value = parseNumberAfterKeyword(line, "字距|字间距|letter spacing");
        if (value !== null) {
          commands.push({
            type: "capability",
            capabilityId: "text.set-letter-spacing",
            payload: { value },
          });
          notes.push(`已生成字距命令：${value}px。`);
          matchedTextMutation = true;
        } else {
          warnings.push(`无法从这句里识别字距：${line}`);
        }
      }

      if (hasAlignmentIntent) {
        commands.push({
          type: "capability",
          capabilityId: "text.set-alignment",
          payload: { value: hasAlignmentIntent },
        });
        notes.push(`已生成文本对齐命令：${hasAlignmentIntent}。`);
        matchedTextMutation = true;
      }

      if (hasFontFamilyIntent) {
        if (fontFamily) {
          commands.push({
            type: "capability",
            capabilityId: "text.set-font-family",
            payload: { family: fontFamily },
          });
          notes.push(`已生成字体命令：${fontFamily}。`);
          matchedTextMutation = true;
        } else {
          warnings.push(`无法从这句里识别字体：${line}`);
        }
      }

      if (hasFontWeightIntent) {
        const value = parseFontWeight(line);
        if (value !== null) {
          commands.push({
            type: "capability",
            capabilityId: "text.set-font-weight",
            payload: { value },
          });
          notes.push(`已生成字重命令：${value}。`);
          matchedTextMutation = true;
        } else {
          warnings.push(`无法从这句里识别字重：${line}`);
        }
      }

      if (matchedTextMutation) {
        if (hasOpacityIntent) {
          matchedDeferredMutation = true;
        } else {
          continue;
        }
      }

      if (!matchedTextMutation || !hasOpacityIntent) {
        continue;
      }
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

    if (hasPaintStyleUpsertIntent && !hasStyleApplyIntent && !hasStyleDetachIntent) {
      const styleHex = color as string;
      const styleTargetName = styleName as string;
      commands.push({
        type: "capability",
        capabilityId: "styles.upsert-paint-style",
        payload: {
          name: styleTargetName,
          hex: styleHex,
          applyToSelection: line.includes("应用"),
        },
      });
      notes.push(`已生成样式命令：${styleTargetName}。`);
      continue;
    }

    if (
      hasFillIntent ||
      hasStrokeWeightIntent ||
      hasStrokeColorIntent ||
      hasShadowIntent ||
      hasLayerBlurIntent ||
      hasRadiusIntent ||
      hasOpacityIntent
    ) {
      let matchedVisualMutation = false;

      if (hasFillIntent) {
        const hex = fillColor || color;
        if (hex) {
          commands.push({
            type: "capability",
            capabilityId: "fills.set-fill",
            payload: { hex },
          });
          notes.push(`已生成填充颜色命令：${hex}。`);
          matchedVisualMutation = true;
        } else {
          warnings.push(`无法从这句里识别填充颜色：${line}`);
        }
      }

      if (hasStrokeWeightIntent) {
        const value = parseNumberAfterKeyword(line, "粗细|宽度|weight|thickness");
        if (value !== null) {
          commands.push({
            type: "capability",
            capabilityId: "strokes.set-weight",
            payload: { value },
          });
          notes.push(`已生成描边粗细命令：${value}px。`);
          matchedVisualMutation = true;
        } else {
          warnings.push(`无法从这句里识别描边粗细：${line}`);
        }
      }

      if (hasStrokeColorIntent) {
        const hex = strokeColor || color;
        if (hex) {
          commands.push({
            type: "capability",
            capabilityId: "strokes.set-stroke",
            payload: { hex },
          });
          notes.push(`已生成描边颜色命令：${hex}。`);
          matchedVisualMutation = true;
        } else {
          warnings.push(`无法从这句里识别描边颜色：${line}`);
        }
      }

      if (hasShadowIntent) {
        const shadowSegment = line.split(/(?:模糊|blur)/i)[0] ?? line;
        const shadowValues = resolveNumbers(shadowSegment);
        const [offsetX = 0, offsetY = 4, blur = 16] = shadowValues;
        commands.push({
          type: "capability",
          capabilityId: "effects.set-shadow",
          payload: {
            offsetX,
            offsetY,
            blur,
            colorHex: shadowColor || color || "#000000",
          },
        });
        notes.push(`已生成阴影命令：offset(${offsetX}, ${offsetY}) blur ${blur}。`);
        matchedVisualMutation = true;
      }

      if (hasLayerBlurIntent) {
        const radius = parseNumberAfterKeyword(line, "模糊|blur");
        if (radius !== null) {
          commands.push({
            type: "capability",
            capabilityId: "effects.set-layer-blur",
            payload: { radius },
          });
          notes.push(`已生成图层模糊命令：${radius}px。`);
          matchedVisualMutation = true;
        } else {
          warnings.push(`无法从这句里识别模糊半径：${line}`);
        }
      }

      if (hasRadiusIntent) {
        const value = parseNumberAfterKeyword(line, "圆角|radius");
        if (value !== null) {
          commands.push({
            type: "capability",
            capabilityId: "geometry.set-radius",
            payload: { value },
          });
          notes.push(`已生成圆角命令：${value}px。`);
          matchedVisualMutation = true;
        } else {
          warnings.push(`无法从这句里识别圆角数值：${line}`);
        }
      }

      if (hasOpacityIntent) {
        const value = parseNumberAfterKeyword(line, "透明度|opacity");
        if (value !== null) {
          commands.push({
            type: "capability",
            capabilityId: "nodes.set-opacity",
            payload: { value },
          });
          notes.push(`已生成透明度命令：${value}%。`);
          matchedVisualMutation = true;
        } else {
          warnings.push(`无法从这句里识别透明度：${line}`);
        }
      }

      if (matchedVisualMutation) {
        matchedDeferredMutation = true;
      }
    }

    if (matchedDeferredMutation || warnings.length > warningsBeforeLine) {
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
