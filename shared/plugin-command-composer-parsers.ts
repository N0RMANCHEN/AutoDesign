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

function stripHexLiteralsForNumberParsing(text: string) {
  return text.replace(/#[\da-fA-F]{3,8}\b/g, " ");
}

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

export function resolveColor(text: string) {
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

export function parseColorAfterKeyword(text: string, keywordPattern: string) {
  const hexMatch = text.match(
    new RegExp(`(?:${keywordPattern})(?:\\s*(?:颜色|color))?\\s*(#[\\da-fA-F]{3,6}\\b)`, "i"),
  );
  if (hexMatch) {
    return normalizeHex(hexMatch[1]);
  }

  for (const [name, hex] of namedColors) {
    const namedMatch = text.match(
      new RegExp(`(?:${keywordPattern})(?:\\s*(?:颜色|color))?\\s*(${name})(?=\\s|$)`, "i"),
    );
    if (namedMatch) {
      return hex;
    }
  }

  return null;
}

export function resolveNumber(text: string) {
  const matched = stripHexLiteralsForNumberParsing(text).match(/-?\d+(\.\d+)?/);
  if (!matched) {
    return null;
  }

  return Number.parseFloat(matched[0]);
}

export function resolveNumbers(text: string) {
  return Array.from(stripHexLiteralsForNumberParsing(text).matchAll(/-?\d+(\.\d+)?/g)).map((match) =>
    Number.parseFloat(match[0]),
  );
}

export function parseNumberAfterKeyword(text: string, keywordPattern: string) {
  const match = stripHexLiteralsForNumberParsing(text).match(
    new RegExp(`(?:${keywordPattern})\\s*(-?\\d+(?:\\.\\d+)?)`, "i"),
  );
  return match ? Number.parseFloat(match[1]) : null;
}

export function parseNumberPairAfterKeyword(text: string, keywordPattern: string) {
  const match = stripHexLiteralsForNumberParsing(text).match(
    new RegExp(`(?:${keywordPattern})\\s*(-?\\d+(?:\\.\\d+)?)\\s+(-?\\d+(?:\\.\\d+)?)`, "i"),
  );
  if (!match) {
    return null;
  }
  return [Number.parseFloat(match[1]), Number.parseFloat(match[2])] as const;
}

export function parseVariableToken(text: string) {
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

export function parseStyleName(text: string) {
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

function parseQuotedValueAfterKeyword(text: string, keywordPattern: string) {
  const match = text.match(
    new RegExp(`(?:${keywordPattern})\\s*[""'“”「」『』](.+?)[""'“”「」『』]`, "i"),
  );
  return match ? match[1].trim() : null;
}

export function parseFontFamily(text: string) {
  const quoted = parseQuotedValueAfterKeyword(text, "字体|font family");
  if (quoted) {
    return quoted;
  }

  const match = text.match(
    /(?:字体|font family)\s+(.+?)(?=\s+(?:-?\d+(?:\.\d+)?(?:px)?|字号|font size|行高|line height|字重|font weight|字距|字间距|letter spacing|文字颜色|文本颜色|字体颜色|text color|颜色|color|左对齐|右对齐|居中对齐|文本居中|文字居中|两端对齐|align left|align center|align right|justify|#[\da-fA-F]{3,6}\b)|$)/i,
  );
  return match ? match[1].trim() : null;
}

export function parseTextValue(text: string) {
  const quoted = parseQuotedValue(text);
  if (quoted) {
    return quoted;
  }

  const match = text.match(
    /(?:文本|文字|content)\s*(?:改成|改为|设为|设置为|设置成)?\s*(.+?)(?=\s+(?:字体|font family|字号|font size|行高|line height|字重|font weight|字距|字间距|letter spacing|文字颜色|文本颜色|字体颜色|text color|左对齐|右对齐|居中对齐|文本居中|文字居中|两端对齐|align left|align center|align right|justify)|$)/i,
  );
  if (!match) {
    return null;
  }

  const value = match[1].trim();
  if (!value || /^(?:颜色|样式|字号|行高|字重|字距|字间距|字体|对齐)\b/i.test(value)) {
    return null;
  }

  return value;
}

export function parseFontWeight(text: string) {
  if (text.includes("粗体")) {
    return "Bold";
  }
  if (text.includes("常规")) {
    return "Regular";
  }
  if (text.includes("细体")) {
    return "Light";
  }

  const value = parseNumberAfterKeyword(text, "字重|font weight");
  if (value !== null) {
    return value;
  }

  const match = text.match(/(?:字重|font weight)\s+([^\s，。；;]+)/i);
  return match ? match[1].trim() : null;
}

export function parseTextAlignment(text: string) {
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

export function parseNamedStyleTarget(text: string, keyword: string) {
  const quoted = parseQuotedValue(text);
  if (quoted) {
    return quoted;
  }

  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(
    new RegExp(
      `${escaped}\\s+(.+?)(?=\\s+(?:字体|font family|字号|font size|行高|line height|字重|font weight|颜色|color|对齐|align|透明度|opacity|圆角|radius|描边|stroke|边框|粗细|宽度|weight|thickness|填充|fill|阴影|shadow|模糊|blur|尺寸|大小|宽高|size|位置|坐标|position|move to|#[\\da-fA-F]{3,6}\\b)|$)`,
      "i",
    ),
  );
  return match ? match[1].trim() : null;
}

export function parseExplicitName(text: string) {
  const quoted = parseQuotedValue(text);
  if (quoted) {
    return quoted;
  }

  const direct = text.match(
    /(?:重命名为|命名为|名字叫|名称为|叫做|分组为|编组为|名字改成|名字改为|名称改成|名称改为|名字设为|名称设为)\s*(.+?)(?=\s+(?:padding|内边距|gap|字体|font family|字号|font size|行高|line height|字重|font weight|字距|字间距|letter spacing|文字颜色|文本颜色|字体颜色|text color|透明度|opacity|圆角|radius|描边|stroke|边框|粗细|宽度|weight|thickness|填充|fill|阴影|shadow|模糊|blur|尺寸|大小|宽高|size|位置|坐标|position|move to|#[\da-fA-F]{3,6}\b)|$)/i,
  );
  if (direct) {
    return direct[1].trim();
  }

  const shortName = text.match(/名字\s+(.+?)(?=\s+的|\s+(?:padding|内边距)\b|$)/i);
  return shortName ? shortName[1].trim() : null;
}

export function parseRectanglePlacement(text: string) {
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

export function parseRectangleSize(text: string) {
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

export function parseGap(text: string) {
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

export function extractDrawingClause(text: string) {
  const match = text.match(/(画|创建|新建).*/i);
  return match ? match[0] : text;
}
