export type CodeToFigmaTarget = {
  fidelity: "editable-exact";
  breakpoint: "desktop";
  degradationPolicy: "forbid";
};

export type CodeToFigmaFileKind = "css" | "script";
export type CodeToFigmaFindingSeverity = "error" | "warning";

export type CodeToFigmaSourceFile = {
  path: string;
  kind: CodeToFigmaFileKind;
  content: string;
};

export type CodeToFigmaFinding = {
  code: string;
  severity: CodeToFigmaFindingSeverity;
  category: string;
  message: string;
  suggestion: string;
  filePath: string;
  fileKind: CodeToFigmaFileKind;
  line: number;
  excerpt: string;
};

export type CodeToFigmaPreflightSummary = {
  scannedFileCount: number;
  cssFileCount: number;
  scriptFileCount: number;
  errorCount: number;
  warningCount: number;
  blocked: boolean;
};

export type CodeToFigmaPreflightReport = {
  kind: "code_to_figma_preflight";
  ruleVersion: "v1";
  projectRoot: string;
  projectName: string | null;
  entryPaths: string[];
  target: CodeToFigmaTarget;
  summary: CodeToFigmaPreflightSummary;
  blockers: string[];
  findings: CodeToFigmaFinding[];
  assumptions: string[];
  supported: boolean;
};

type PatternRule = {
  code: string;
  category: string;
  message: string;
  suggestion: string;
  regex: RegExp;
  severity: CodeToFigmaFindingSeverity;
};

export const DEFAULT_CODE_TO_FIGMA_TARGET: CodeToFigmaTarget = {
  fidelity: "editable-exact",
  breakpoint: "desktop",
  degradationPolicy: "forbid",
};

const CSS_RULES: PatternRule[] = [
  {
    code: "css-grid-layout",
    category: "layout",
    severity: "warning",
    regex: /^\s*display\s*:\s*grid\b/gimu,
    message: "CSS Grid 需要走固定桌面下的显式轨道测量与绝对布局映射，不再作为预检 blocker。",
    suggestion: "后续生成链需要把 grid 轨道和 item 位置落成显式 Frame/position 数据。",
  },
  {
    code: "css-grid-primitive",
    category: "layout",
    severity: "warning",
    regex: /^\s*grid-template(?:-[a-z-]+)?\s*:/gimu,
    message: "Grid template 需要在固定桌面断点下先解析成显式列轨道尺寸。",
    suggestion: "后续生成链需要把 template 计算值转成明确的 Frame 宽度和节点坐标。",
  },
  {
    code: "responsive-css-function",
    category: "responsive",
    severity: "warning",
    regex: /\b(?:clamp|min|max|calc)\s*\(/giu,
    message: "动态 CSS 函数需要在固定桌面断点下先求值，不再作为预检 blocker。",
    suggestion: "后续生成链需要引入 computed-style capture，把表达式先折叠成确定值。",
  },
  {
    code: "media-query",
    category: "responsive",
    severity: "warning",
    regex: /@media\b/giu,
    message: "media query 需要在固定桌面断点下选定 active branch。",
    suggestion: "后续生成链需要明确 desktop viewport，只消费命中的规则分支。",
  },
  {
    code: "container-query",
    category: "responsive",
    severity: "error",
    regex: /@container\b|\bcontainer-type\s*:/giu,
    message: "Container query 目前不在可逆子集里。",
    suggestion: "移除 container query，改成固定桌面布局。",
  },
  {
    code: "viewport-relative-unit",
    category: "responsive",
    severity: "warning",
    regex: /(?:^|[^\w-])-?\d*\.?\d+\s*(?:dvh|dvw|svh|svw|lvh|lvw|vh|vw|vmin|vmax)\b/giu,
    message: "viewport 相对单位需要在固定 desktop viewport 下先求值。",
    suggestion: "后续生成链需要锁定 viewport，并把相对单位换算成绝对尺寸。",
  },
  {
    code: "transform",
    category: "effects",
    severity: "error",
    regex: /^\s*transform\s*:/gimu,
    message: "transform 目前没有纳入 editable-exact 映射面。",
    suggestion: "改成静态几何或显式布局结构。",
  },
  {
    code: "filter-or-backdrop-filter",
    category: "effects",
    severity: "error",
    regex: /^\s*(?:filter|backdrop-filter)\s*:/gimu,
    message: "filter / backdrop-filter 无法在当前阶段承诺无降级可编辑还原。",
    suggestion: "移除滤镜效果，或先把这类页面判定为不支持。",
  },
  {
    code: "blend-mode",
    category: "effects",
    severity: "error",
    regex: /^\s*(?:mix-blend-mode|background-blend-mode)\s*:/gimu,
    message: "blend mode 目前不在可逆子集里。",
    suggestion: "改成普通填充与层级叠放。",
  },
  {
    code: "mask",
    category: "effects",
    severity: "error",
    regex: /^\s*mask(?:-[a-z-]+)?\s*:/gimu,
    message: "mask 相关样式会阻断当前可编辑还原主链。",
    suggestion: "改成显式容器裁切或把该页面排除出第一阶段。",
  },
  {
    code: "fixed-or-sticky-positioning",
    category: "layout",
    severity: "error",
    regex: /^\s*position\s*:\s*(?:fixed|sticky)\b/gimu,
    message: "fixed/sticky 布局当前不在第一阶段可逆合同内。",
    suggestion: "先收成普通流式或绝对定位布局。",
  },
  {
    code: "animation-or-transition",
    category: "motion",
    severity: "error",
    regex: /^\s*(?:animation|transition)\s*:/gimu,
    message: "动画与过渡不属于静态桌面页面的可编辑还原范围。",
    suggestion: "第一阶段移除 motion 定义，只保留静态最终态。",
  },
  {
    code: "pseudo-element",
    category: "structure",
    severity: "error",
    regex: /::(?:before|after)\b/giu,
    message: "伪元素目前不会被自动还原成显式 Figma 节点。",
    suggestion: "把伪元素改成真实 DOM 节点。",
  },
  {
    code: "font-fallback-stack",
    category: "font",
    severity: "warning",
    regex: /^\s*font-family\s*:[^;]*,[^;]+;/gimu,
    message: "font-family 使用 fallback stack，需单独确认浏览器与 Figma 的本机字体一致。",
    suggestion: "为首选字体建立显式安装校验，避免换行与字宽漂移。",
  },
  {
    code: "gradient-fill",
    category: "paint",
    severity: "warning",
    regex: /^\s*background(?:-image)?\s*:[^;]*gradient\(/gimu,
    message: "渐变虽然可映射，但仍需单独校验角度与 stop 是否一致。",
    suggestion: "进入实现前先补梯度映射与回归比对。",
  },
  {
    code: "aspect-ratio",
    category: "layout",
    severity: "warning",
    regex: /^\s*aspect-ratio\s*:/gimu,
    message: "aspect-ratio 需要额外的图片/容器裁切映射才能保持精确。",
    suggestion: "补充图片裁切 contract，再承诺无偏差还原。",
  },
  {
    code: "object-fit",
    category: "layout",
    severity: "warning",
    regex: /^\s*object-fit\s*:/gimu,
    message: "object-fit 需要额外的 image-fill 对齐逻辑。",
    suggestion: "进入实现前先补图片裁切与 focal point 校验。",
  },
];

const SCRIPT_RULES: PatternRule[] = [
  {
    code: "stateful-react-hook",
    category: "interactivity",
    severity: "error",
    regex: /\buse(?:State|Effect|LayoutEffect|Reducer|Context|SyncExternalStore|ActionState|Optimistic|Transition|DeferredValue)\b/gu,
    message: "当前 editable-exact preflight 只接受静态页面，不接受 stateful React hooks。",
    suggestion: "先把目标页面收成静态桌面态，再进入可编辑还原链。",
  },
  {
    code: "network-or-runtime-side-effect",
    category: "runtime",
    severity: "error",
    regex: /\b(?:fetch|axios|XMLHttpRequest|WebSocket|EventSource)\b/gu,
    message: "网络或运行时副作用会破坏静态页面可逆前提。",
    suggestion: "第一阶段仅支持无运行时副作用的静态页面。",
  },
  {
    code: "browser-global",
    category: "runtime",
    severity: "error",
    regex: /\b(?:window|localStorage|sessionStorage|history|location)\b|\bdocument\.(?!getElementById\b)/gu,
    message: "浏览器全局依赖意味着当前页面不是纯静态结构输入。",
    suggestion: "把运行时依赖剥离到页面外层，保持目标页面静态可渲染。",
  },
  {
    code: "jsx-event-handler",
    category: "interactivity",
    severity: "error",
    regex: /\bon(?:Click|Change|Submit|Input|Focus|Blur|KeyDown|KeyUp|PointerDown|PointerUp|MouseDown|MouseUp|MouseEnter|MouseLeave|TouchStart|TouchEnd|Scroll)\s*=/gu,
    message: "事件处理器说明页面包含交互态，不在第一阶段静态还原范围里。",
    suggestion: "先锁定静态展示态，移除交互入口或拆出纯展示组件。",
  },
  {
    code: "inline-style-object",
    category: "style",
    severity: "error",
    regex: /\bstyle\s*=\s*\{\{/gu,
    message: "inline style object 无法通过当前静态 CSS 审计稳定解析。",
    suggestion: "把样式收敛到独立 CSS 文件或显式 design token。",
  },
  {
    code: "css-in-js",
    category: "style",
    severity: "warning",
    regex: /from\s+["'](?:@emotion\/react|@emotion\/styled|styled-components|@mui\/material\/styles)["']|\bsx\s*=\s*\{|\bstyled\s*\(/gu,
    message: "CSS-in-JS 需要通过运行态 computed style 捕获，而不是只看源码文本。",
    suggestion: "后续生成链需要补 runtime style capture，不能只靠静态 CSS 解析。",
  },
  {
    code: "conditional-rendering",
    category: "structure",
    severity: "warning",
    regex: /(?:\?\s*<|&&\s*<)/gu,
    message: "条件渲染需要额外锁定目标态，否则 DOM 结构不稳定。",
    suggestion: "为第一阶段页面明确唯一静态态，再继续实现。",
  },
];

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function compareFindings(left: CodeToFigmaFinding, right: CodeToFigmaFinding) {
  const severityOrder = left.severity === right.severity
    ? 0
    : left.severity === "error"
      ? -1
      : 1;
  if (severityOrder !== 0) {
    return severityOrder;
  }
  const pathOrder = left.filePath.localeCompare(right.filePath);
  if (pathOrder !== 0) {
    return pathOrder;
  }
  const lineOrder = left.line - right.line;
  if (lineOrder !== 0) {
    return lineOrder;
  }
  return left.code.localeCompare(right.code);
}

function locateLine(content: string, index: number) {
  const boundedIndex = Math.max(0, Math.min(index, content.length));
  const before = content.slice(0, boundedIndex);
  const line = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;
  const nextNewline = content.indexOf("\n", boundedIndex);
  const lineEnd = nextNewline >= 0 ? nextNewline : content.length;
  const excerpt = content.slice(lineStart, lineEnd).trim();
  return {
    line,
    excerpt,
  };
}

function collectFindingsForRule(
  file: CodeToFigmaSourceFile,
  rule: PatternRule,
): CodeToFigmaFinding[] {
  const findings: CodeToFigmaFinding[] = [];
  const regex = new RegExp(rule.regex.source, rule.regex.flags);
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(file.content)) !== null) {
    const index = match.index ?? 0;
    const location = locateLine(file.content, index);
    const fingerprint = `${file.path}:${location.line}:${rule.code}`;
    if (seen.has(fingerprint)) {
      continue;
    }
    seen.add(fingerprint);
    findings.push({
      code: rule.code,
      severity: rule.severity,
      category: rule.category,
      message: rule.message,
      suggestion: rule.suggestion,
      filePath: file.path,
      fileKind: file.kind,
      line: location.line,
      excerpt: location.excerpt,
    });
  }
  return findings;
}

export function runCodeToFigmaPreflight(params: {
  projectRoot: string;
  projectName?: string | null;
  entryPaths?: string[];
  files: CodeToFigmaSourceFile[];
  target?: CodeToFigmaTarget;
}): CodeToFigmaPreflightReport {
  const target = params.target ?? DEFAULT_CODE_TO_FIGMA_TARGET;
  const findings = params.files.flatMap((file) => {
    const rules = file.kind === "css" ? CSS_RULES : SCRIPT_RULES;
    return rules.flatMap((rule) => collectFindingsForRule(file, rule));
  }).sort(compareFindings);

  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const warningCount = findings.length - errorCount;
  const blockers = uniqueStrings(
    findings.filter((finding) => finding.severity === "error").map((finding) => finding.code),
  );

  return {
    kind: "code_to_figma_preflight",
    ruleVersion: "v1",
    projectRoot: params.projectRoot,
    projectName: params.projectName ?? null,
    entryPaths: uniqueStrings(params.entryPaths ?? []),
    target,
    summary: {
      scannedFileCount: params.files.length,
      cssFileCount: params.files.filter((file) => file.kind === "css").length,
      scriptFileCount: params.files.filter((file) => file.kind === "script").length,
      errorCount,
      warningCount,
      blocked: errorCount > 0,
    },
    blockers,
    findings,
    assumptions: [
      "第一阶段目标固定为桌面端静态页面，不覆盖响应式断点和交互态。",
      "任何未进入可逆子集的特性都应直接 fail fast，而不是做隐式近似。",
      "即使 preflight 通过，字体仍需在浏览器与 Figma 本机环境中逐项校验。",
    ],
    supported: errorCount === 0,
  };
}

export function formatCodeToFigmaPreflightReport(
  report: CodeToFigmaPreflightReport,
) {
  const lines = [
    "Code-to-Figma Preflight",
    `project: ${report.projectRoot}`,
    `project_name: ${report.projectName || "unknown"}`,
    `target: ${report.target.fidelity} / ${report.target.breakpoint} / ${report.target.degradationPolicy}`,
    `verdict: ${report.supported ? "PASS" : "BLOCKED"}`,
    `scanned: ${report.summary.scannedFileCount} files (css=${report.summary.cssFileCount}, script=${report.summary.scriptFileCount})`,
    `findings: errors=${report.summary.errorCount}, warnings=${report.summary.warningCount}`,
  ];

  if (report.entryPaths.length > 0) {
    lines.push(`entry_paths: ${report.entryPaths.join(", ")}`);
  }

  if (report.findings.length === 0) {
    lines.push("");
    lines.push("No blocking or warning findings.");
    return lines.join("\n");
  }

  lines.push("");
  lines.push("Findings:");

  for (const finding of report.findings) {
    lines.push(
      `- [${finding.severity}] ${finding.code} ${finding.filePath}:${finding.line} ${finding.message}`,
    );
    if (finding.excerpt) {
      lines.push(`  evidence: ${finding.excerpt}`);
    }
    lines.push(`  next: ${finding.suggestion}`);
  }

  return lines.join("\n");
}
