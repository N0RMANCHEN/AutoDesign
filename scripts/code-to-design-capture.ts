import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildCodeToDesignRuntimeSnapshot, type CodeToDesignNodeSnapshot } from "../shared/code-to-design-snapshot.js";

const MIME_TYPES = new Map<string, string>([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".webp", "image/webp"],
]);

const DEFAULT_CHROME_CANDIDATES = [
  process.env.AUTODESIGN_CHROME_BIN || "",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
const CAPTURE_QUERY_PARAM = "__autodesign_capture";
const CHROME_TIMEOUT_MS = 30_000;

type CapturePayload = {
  page: {
    title: string;
    urlPath: string;
    scrollWidth: number;
    scrollHeight: number;
    backgroundColor: string;
    backgroundImage: string;
  };
  nodes: CodeToDesignNodeSnapshot[];
};

type CaptureSubmission =
  | { ok: true; payload: CapturePayload }
  | { ok: false; error: string };

function fail(message: string): never {
  throw new Error(message);
}

function readFlag(argv: string[], name: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function readFlags(argv: string[], name: string) {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== name) {
      continue;
    }
    const value = argv[index + 1] ?? null;
    if (value && !value.startsWith("--")) {
      values.push(value);
    }
  }
  return values;
}

function hasFlag(argv: string[], name: string) {
  return argv.includes(name);
}

function sanitizeCaptureRoute(route: string | null) {
  const value = String(route || "/").trim();
  if (!value) {
    return "/";
  }
  return value.startsWith("/") ? value : `/${value}`;
}

async function exists(targetPath: string) {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveProjectName(projectRoot: string | null) {
  if (!projectRoot) {
    return null;
  }
  try {
    const raw = await readFile(path.join(projectRoot, "package.json"), "utf8");
    const payload = JSON.parse(raw) as { name?: string };
    return typeof payload.name === "string" ? payload.name : null;
  } catch {
    return null;
  }
}

async function resolveDistRoot(argv: string[]) {
  const explicitDist = readFlag(argv, "--dist");
  if (explicitDist) {
    return path.resolve(explicitDist);
  }
  const projectRoot = readFlag(argv, "--project");
  if (!projectRoot) {
    fail("--dist or --project is required");
  }
  return path.resolve(projectRoot, "dist");
}

export async function guessChromeBinary(explicitChromeBin: string | null = null) {
  const candidates = explicitChromeBin ? [explicitChromeBin, ...DEFAULT_CHROME_CANDIDATES] : DEFAULT_CHROME_CANDIDATES;
  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim();
    if (!normalized) {
      continue;
    }
    if (await exists(normalized)) {
      return normalized;
    }
  }
  fail("No supported Chrome binary was found. Pass --chrome-bin explicitly.");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function buildCaptureInjectionScript() {
  return [
    "<script id=\"autodesign-capture-bootstrap\" data-autodesign-capture-helper=\"true\">",
    "const payloadScript = document.createElement('script');",
    "payloadScript.type = 'application/json';",
    "payloadScript.id = 'autodesign-capture-payload';",
    "payloadScript.setAttribute('data-autodesign-capture-helper', 'true');",
    "const CAPTURE_HELPER_PREFIX = 'autodesign-capture-';",
    "const IGNORED_TAG_NAMES = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE']);",
    "async function postCaptureResult(payload) {",
    "  await fetch('/__autodesign__/capture-result', {",
    "    method: 'POST',",
    "    headers: { 'content-type': 'application/json' },",
    "    body: JSON.stringify(payload),",
    "  });",
    "}",
    "function normalizeClassName(element) {",
    "  if (typeof element.className === 'string') return element.className.trim() || null;",
    "  const attr = element.getAttribute('class');",
    "  return attr && attr.trim() ? attr.trim() : null;",
    "}",
    "function parseFontFamilies(value) {",
    "  return Array.from(new Set(String(value || '')",
    "    .split(',')",
    "    .map((item) => item.trim().replace(/^['\\\"]|['\\\"]$/g, ''))",
    "    .filter(Boolean)));",
    "}",
    "function buildFontProbeString(style, family) {",
    "  const familyValue = family.includes(' ') ? `\\\"${family}\\\"` : family;",
    "  return `${style.fontStyle || 'normal'} ${style.fontWeight || '400'} ${style.fontSize || '16px'} ${familyValue}`;",
    "}",
    "const captureMeasureCanvas = document.createElement('canvas');",
    "const captureMeasureContext = captureMeasureCanvas.getContext('2d');",
    "function measureTextWidth(text, font) {",
    "  if (!captureMeasureContext) return 0;",
    "  captureMeasureContext.font = font;",
    "  return captureMeasureContext.measureText(text).width;",
    "}",
    "function normalizeResolvedFontStyle(style) {",
    "  const fontWeight = Number.parseInt(style.fontWeight || '400', 10);",
    "  let weightName = 'Regular';",
    "  if (Number.isFinite(fontWeight)) {",
    "    if (fontWeight >= 800) weightName = 'Extra Bold';",
    "    else if (fontWeight >= 700) weightName = 'Bold';",
    "    else if (fontWeight >= 600) weightName = 'Semibold';",
    "    else if (fontWeight >= 500) weightName = 'Medium';",
    "    else if (fontWeight < 400) weightName = 'Light';",
    "  }",
    "  return String(style.fontStyle || '').trim().toLowerCase() === 'italic' ? `${weightName} Italic` : weightName;",
    "}",
    "function resolveBrowserFontFamily(style, directText) {",
    "  const families = parseFontFamilies(style.fontFamily);",
    "  if (!families.length) return null;",
    "  const sample = (directText && directText.trim()) || 'Hamburgefontsiv 0123456789';",
    "  const referenceWidth = measureTextWidth(sample, buildFontProbeString(style, style.fontFamily));",
    "  for (const family of families) {",
    "    const width = measureTextWidth(sample, buildFontProbeString(style, family));",
    "    if (Math.abs(width - referenceWidth) < 0.01) return family;",
    "  }",
    "  return families[0] || null;",
    "}",
    "function isCaptureHelper(element) {",
    "  if (!element || !(element instanceof Element)) return false;",
    "  if (element.getAttribute('data-autodesign-capture-helper') === 'true') return true;",
    "  if (String(element.id || '').startsWith(CAPTURE_HELPER_PREFIX)) return true;",
    "  if (IGNORED_TAG_NAMES.has(element.tagName)) return true;",
    "  return false;",
    "}",
    "function textContentFromNode(node) {",
    "  return Array.from(node.childNodes)",
    "    .filter((child) => child.nodeType === Node.TEXT_NODE)",
    "    .map((child) => child.textContent || '')",
    "    .join(' ')",
    "    .replace(/\\s+/g, ' ')",
    "    .trim();",
    "}",
    "function buildDomPath(element) {",
    "  const parts = [];",
    "  let current = element;",
    "  while (current && current !== document.body) {",
    "    const className = normalizeClassName(current);",
    "    const classPart = className ? '.' + className.split(/\\s+/).slice(0, 2).join('.') : '';",
    "    const parent = current.parentElement;",
    "    let suffix = '';",
    "    if (parent) {",
    "      const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);",
    "      if (siblings.length > 1) suffix = `:nth-of-type(${siblings.indexOf(current) + 1})`;",
    "    }",
    "    parts.unshift(`${current.tagName.toLowerCase()}${classPart}${suffix}`);",
    "    current = parent;",
    "  }",
    "  return ['body', ...parts].join(' > ');",
    "}",
    "function chooseRole(element, directText, style) {",
    "  if (element.tagName === 'IMG') return 'image';",
    "  if (directText) return 'text';",
    "  if (element.children.length > 0) return 'frame';",
    "  if (['HEADER', 'MAIN', 'SECTION', 'ASIDE', 'FIGURE', 'ARTICLE', 'NAV', 'DIV', 'FOOTER'].includes(element.tagName)) return 'frame';",
    "  if (style.backgroundImage !== 'none' || style.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(style.borderTopWidth) > 0 || parseFloat(style.borderRightWidth) > 0 || parseFloat(style.borderBottomWidth) > 0 || parseFloat(style.borderLeftWidth) > 0) return 'shape';",
    "  return 'unknown';",
    "}",
    "async function imageDataUrl(element) {",
    "  if (element.tagName !== 'IMG' || !element.currentSrc) return null;",
    "  try {",
    "    if (typeof element.decode === 'function') {",
    "      await element.decode().catch(() => null);",
    "    }",
    "    const width = element.naturalWidth || Math.round(element.width) || 0;",
    "    const height = element.naturalHeight || Math.round(element.height) || 0;",
    "    if (width <= 0 || height <= 0) return null;",
    "    const canvas = document.createElement('canvas');",
    "    canvas.width = width;",
    "    canvas.height = height;",
    "    const context = canvas.getContext('2d');",
    "    if (!context) return null;",
    "    context.drawImage(element, 0, 0, width, height);",
    "    return canvas.toDataURL('image/png');",
    "  } catch {",
    "    return null;",
    "  }",
    "}",
    "function styleSnapshot(style) {",
    "  return {",
    "    display: style.display,",
    "    position: style.position,",
    "    color: style.color,",
    "    opacity: Number(style.opacity || '1'),",
    "    backgroundColor: style.backgroundColor,",
    "    backgroundImage: style.backgroundImage,",
    "    borderTopWidth: style.borderTopWidth,",
    "    borderRightWidth: style.borderRightWidth,",
    "    borderBottomWidth: style.borderBottomWidth,",
    "    borderLeftWidth: style.borderLeftWidth,",
    "    borderTopColor: style.borderTopColor,",
    "    borderRightColor: style.borderRightColor,",
    "    borderBottomColor: style.borderBottomColor,",
    "    borderLeftColor: style.borderLeftColor,",
    "    borderTopLeftRadius: style.borderTopLeftRadius,",
    "    borderTopRightRadius: style.borderTopRightRadius,",
    "    borderBottomRightRadius: style.borderBottomRightRadius,",
    "    borderBottomLeftRadius: style.borderBottomLeftRadius,",
    "    fontFamily: style.fontFamily,",
    "    fontStyle: style.fontStyle,",
    "    fontSize: style.fontSize,",
    "    fontWeight: style.fontWeight,",
    "    lineHeight: style.lineHeight,",
    "    letterSpacing: style.letterSpacing,",
    "    textAlign: style.textAlign,",
    "    textTransform: style.textTransform,",
    "    objectFit: style.objectFit,",
    "    gridTemplateColumns: style.gridTemplateColumns,",
    "    gridTemplateRows: style.gridTemplateRows,",
    "    gap: style.gap,",
    "    rowGap: style.rowGap,",
    "    columnGap: style.columnGap,",
    "    flexDirection: style.flexDirection,",
    "    justifyContent: style.justifyContent,",
    "    alignItems: style.alignItems,",
    "    alignSelf: style.alignSelf,",
    "    paddingTop: style.paddingTop,",
    "    paddingRight: style.paddingRight,",
    "    paddingBottom: style.paddingBottom,",
    "    paddingLeft: style.paddingLeft,",
    "  };",
    "}",
    "async function collect() {",
    "  if (document.fonts && document.fonts.ready) {",
    "    await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1500))]);",
    "  }",
    "  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));",
    "  const elements = Array.from(document.body.querySelectorAll('*')).filter((element) => !isCaptureHelper(element));",
    "  const nodes = [];",
    "  for (const [index, element] of elements.entries()) {",
    "    const elementId = `node-${index + 1}`;",
    "    element.dataset.autodesignCaptureId = elementId;",
    "    const rect = element.getBoundingClientRect();",
    "    const style = getComputedStyle(element);",
    "    const directText = textContentFromNode(element);",
    "    const visible = style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0 && rect.width > 0 && rect.height > 0;",
    "    if (!visible && !directText) continue;",
    "    const fontFamilyCandidates = parseFontFamilies(style.fontFamily);",
    "    nodes.push({",
    "      id: elementId,",
    "      parentId: element.parentElement ? element.parentElement.dataset.autodesignCaptureId || null : null,",
    "      domPath: buildDomPath(element),",
    "      tagName: element.tagName,",
    "      className: normalizeClassName(element),",
    "      role: chooseRole(element, directText, style),",
    "      name: element.getAttribute('aria-label') || element.getAttribute('alt') || element.tagName,",
    "      visible,",
    "      rect: {",
    "        x: Number(rect.left.toFixed(3)),",
    "        y: Number(rect.top.toFixed(3)),",
    "        width: Number(rect.width.toFixed(3)),",
    "        height: Number(rect.height.toFixed(3)),",
    "      },",
    "      textContent: directText || null,",
    "      fontFamilyCandidates,",
    "      resolvedBrowserFontFamily: directText ? resolveBrowserFontFamily(style, directText) : null,",
    "      resolvedBrowserFontStyle: directText ? normalizeResolvedFontStyle(style) : null,",
    "      styles: styleSnapshot(style),",
    "      image: element.tagName === 'IMG'",
    "        ? { src: element.getAttribute('src'), alt: element.getAttribute('alt'), dataUrl: await imageDataUrl(element) }",
    "        : null,",
    "    });",
    "  }",
    "  payloadScript.textContent = JSON.stringify({",
    "    page: {",
    "      title: document.title || '',",
    "      urlPath: new URL(document.location.href).pathname,",
    "      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),",
    "      scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),",
    "      backgroundColor: getComputedStyle(document.body).backgroundColor,",
    "      backgroundImage: getComputedStyle(document.body).backgroundImage,",
    "    },",
    "    nodes,",
    "  });",
    "  await postCaptureResult({ ok: true, payload: JSON.parse(payloadScript.textContent) });",
    "  document.body.innerHTML = '';",
    "  document.body.appendChild(payloadScript);",
    "}",
    "let captureStarted = false;",
    "function startCapture() {",
    "  if (captureStarted) return;",
    "  captureStarted = true;",
    "  collect().catch((error) => {",
    "    const message = String(error && error.message ? error.message : error);",
    "    postCaptureResult({ ok: false, error: message }).catch(() => null);",
    "    document.body.innerHTML = `<pre id=\"autodesign-capture-error\">${message}</pre>`;",
    "  });",
    "}",
    "if (document.readyState === 'complete') {",
    "  startCapture();",
    "} else {",
    "  window.addEventListener('load', startCapture, { once: true });",
    "  setTimeout(startCapture, 3000);",
    "}",
    "</script>",
  ].join("");
}

export function injectCapturePayloadIntoHtml(documentHtml: string) {
  const injection = `${buildCaptureInjectionScript()}\n`;
  if (documentHtml.includes("</body>")) {
    return documentHtml.replace("</body>", `${injection}</body>`);
  }
  return `${documentHtml}\n${injection}`;
}

function decodeHtmlEntities(value: string) {
  return value
    .replaceAll("&quot;", "\"")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

export function extractCapturePayloadFromDom(domText: string) {
  const payloadMatch = /<script type="application\/json" id="autodesign-capture-payload">([\s\S]*?)<\/script>/i.exec(domText);
  if (!payloadMatch) {
    const errorMatch = /<pre id="autodesign-capture-error">([\s\S]*?)<\/pre>/i.exec(domText);
    if (errorMatch) {
      fail(`capture helper failed: ${decodeHtmlEntities(errorMatch[1].trim())}`);
    }
    fail("capture helper payload missing");
  }
  return JSON.parse(decodeHtmlEntities(payloadMatch[1])) as {
    page: {
      title: string;
      urlPath: string;
      scrollWidth: number;
      scrollHeight: number;
      backgroundColor: string;
      backgroundImage: string;
    };
    nodes: CodeToDesignNodeSnapshot[];
  };
}

function mimeTypeForFile(filePath: string) {
  return MIME_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
}

async function safeReadDistFile(distRoot: string, requestedPath: string) {
  const resolvedPath = path.resolve(distRoot, `.${requestedPath}`);
  if (!resolvedPath.startsWith(path.resolve(distRoot))) {
    return null;
  }

  if (await exists(resolvedPath)) {
    const fileStats = await stat(resolvedPath).catch(() => null);
    if (fileStats?.isFile()) {
      return resolvedPath;
    }
  }

  if (!path.extname(resolvedPath)) {
    const fallback = path.join(distRoot, "index.html");
    if (await exists(fallback)) {
      return fallback;
    }
  }

  return null;
}

async function readRequestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function createCaptureServer(params: { distRoot: string; route: string }) {
  let resolveCaptureResult: ((value: CaptureSubmission) => void) | null = null;
  const captureResultPromise = new Promise<CaptureSubmission>((resolve) => {
    resolveCaptureResult = resolve;
  });
  const sockets = new Set<Socket>();
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    const captureRequested = requestUrl.searchParams.get(CAPTURE_QUERY_PARAM) === "1";

    if (requestUrl.pathname === "/__autodesign__/capture-result") {
      if (request.method !== "POST") {
        response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
        response.end("method not allowed");
        return;
      }
      try {
        const rawBody = await readRequestBody(request);
        const payload = JSON.parse(rawBody) as CaptureSubmission;
        resolveCaptureResult?.(payload);
        resolveCaptureResult = null;
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true }));
      } catch (error) {
        response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        response.end(
          JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : "invalid capture payload",
          }),
        );
      }
      return;
    }

    const distPath = requestUrl.pathname.startsWith("/app")
      ? requestUrl.pathname.replace(/^\/app/, "") || "/"
      : requestUrl.pathname;
    const filePath = await safeReadDistFile(params.distRoot, distPath);
    if (!filePath) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }

    const responseBody =
      captureRequested && path.extname(filePath).toLowerCase() === ".html"
        ? Buffer.from(injectCapturePayloadIntoHtml(await readFile(filePath, "utf8")), "utf8")
        : await readFile(filePath);
    response.writeHead(200, {
      "content-type": mimeTypeForFile(filePath),
      "cache-control": "no-store",
      connection: "close",
    });
    response.end(responseBody);
  });
  server.keepAliveTimeout = 0;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    fail("capture server failed to bind to a local port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async waitForCaptureResult(timeoutMs = CHROME_TIMEOUT_MS) {
      const timeoutPromise = new Promise<CaptureSubmission>((resolve) => {
        setTimeout(() => resolve({ ok: false, error: `capture result timed out after ${timeoutMs}ms` }), timeoutMs);
      });
      const result = await Promise.race([captureResultPromise, timeoutPromise]);
      if (!result.ok) {
        fail(result.error);
      }
      return result.payload;
    },
    async close() {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

export function buildChromeArgs(params: {
  userDataDir: string;
  width: number;
  height: number;
  url: string;
  dumpDom?: boolean;
  screenshotPath?: string | null;
}) {
  return [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--use-mock-keychain",
    "--virtual-time-budget=10000",
    `--user-data-dir=${params.userDataDir}`,
    `--window-size=${Math.max(1, Math.round(params.width))},${Math.max(1, Math.round(params.height))}`,
    ...(params.dumpDom ? ["--dump-dom"] : []),
    ...(params.screenshotPath ? [`--screenshot=${params.screenshotPath}`] : []),
    params.url,
  ];
}

async function runChrome(chromeBinary: string, args: string[]) {
  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(chromeBinary, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeoutHandle = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Chrome timed out after ${CHROME_TIMEOUT_MS}ms: ${args.join(" ")}`));
    }, CHROME_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeoutHandle);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`Chrome exited with code ${code}: ${stderr || stdout}`));
    });
  });
}

async function runChromeUntilFile(params: {
  chromeBinary: string;
  args: string[];
  outputPath: string;
}) {
  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(params.chromeBinary, params.args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const clearAndResolve = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      clearInterval(pollHandle);
      child.kill("SIGKILL");
      resolve({ stdout, stderr });
    };

    const timeoutHandle = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      clearInterval(pollHandle);
      child.kill("SIGKILL");
      reject(new Error(`Chrome timed out after ${CHROME_TIMEOUT_MS}ms: ${params.args.join(" ")}`));
    }, CHROME_TIMEOUT_MS);

    const pollHandle = setInterval(() => {
      void exists(params.outputPath).then((found) => {
        if (found) {
          clearAndResolve();
        }
      });
    }, 150);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      clearInterval(pollHandle);
      reject(error);
    });
    child.on("close", async (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      clearInterval(pollHandle);
      if (code === 0 || (await exists(params.outputPath))) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`Chrome exited with code ${code}: ${stderr || stdout}`));
    });
  });
}

async function runChromeUntilCapture(params: {
  chromeBinary: string;
  args: string[];
  captureResultPromise: Promise<CapturePayload>;
}) {
  return await new Promise<{ stdout: string; stderr: string; payload: CapturePayload }>((resolve, reject) => {
    const child = spawn(params.chromeBinary, params.args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeoutHandle = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`Chrome timed out after ${CHROME_TIMEOUT_MS}ms: ${params.args.join(" ")}`));
    }, CHROME_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      reject(new Error(`Chrome exited before capture result with code ${code}: ${stderr || stdout}`));
    });

    params.captureResultPromise
      .then((payload) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        child.kill("SIGKILL");
        resolve({ stdout, stderr, payload });
      })
      .catch((error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        child.kill("SIGKILL");
        reject(error);
      });
  });
}

function usage() {
  return [
    "Usage:",
    "  npm run code-to-design:capture -- --project ../AItest --entry src/App.tsx",
    "  npm run code-to-design:capture -- --project ../AItest --dist ../AItest/dist --out data/aitest-snapshot.json --screenshot-out data/aitest.png",
  ].join("\n");
}

export async function runCodeToDesignCaptureCli(argv: string[]) {
  if (hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
    return {
      exitCode: 0,
      output: usage(),
      snapshot: null,
    };
  }

  const projectRoot = readFlag(argv, "--project") ? path.resolve(String(readFlag(argv, "--project"))) : null;
  const distRoot = await resolveDistRoot(argv);
  if (!(await exists(distRoot))) {
    fail(`dist root not found: ${distRoot}`);
  }

  const route = sanitizeCaptureRoute(readFlag(argv, "--route"));
  const viewportKey = readFlag(argv, "--viewport-key") || "desktop";
  const viewportWidth = Number(readFlag(argv, "--viewport-width") || 1440);
  const viewportHeight = Number(readFlag(argv, "--viewport-height") || 2200);
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0 || !Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    fail("viewport width and height must be positive numbers");
  }

  const chromeBinary = await guessChromeBinary(readFlag(argv, "--chrome-bin"));
  const projectName = await resolveProjectName(projectRoot);
  const entryPaths = readFlags(argv, "--entry");
  const outputPath = readFlag(argv, "--out");
  const screenshotOutputPath = readFlag(argv, "--screenshot-out");
  const format = readFlag(argv, "--format") || "text";
  if (format !== "text" && format !== "json") {
    fail(`unsupported --format: ${format}`);
  }

  const captureServer = await createCaptureServer({
    distRoot,
    route,
  });

  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-code-capture-"));

  try {
    const captureResult = await runChromeUntilCapture({
      chromeBinary,
      args: buildChromeArgs({
        userDataDir,
        width: viewportWidth,
        height: viewportHeight,
        url: `${captureServer.baseUrl}/app${route}${route.includes("?") ? "&" : "?"}${CAPTURE_QUERY_PARAM}=1`,
      }),
      captureResultPromise: captureServer.waitForCaptureResult(),
    });
    const payload = captureResult.payload;
    const snapshot = buildCodeToDesignRuntimeSnapshot({
      projectRoot,
      projectName,
      route,
      entryPaths,
      viewportKey,
      viewport: {
        width: viewportWidth,
        height: viewportHeight,
        deviceScaleFactor: 1,
      },
      page: payload.page,
      nodes: payload.nodes,
      warnings: [],
    });

    if (outputPath) {
      const resolvedOutputPath = path.resolve(outputPath);
      await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
      await writeFile(resolvedOutputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    }

    if (screenshotOutputPath) {
      const resolvedScreenshotPath = path.resolve(screenshotOutputPath);
      await mkdir(path.dirname(resolvedScreenshotPath), { recursive: true });
      try {
        await runChromeUntilFile({
          chromeBinary,
          args: buildChromeArgs({
            userDataDir,
            width: Math.max(viewportWidth, snapshot.page.scrollWidth),
            height: Math.max(viewportHeight, snapshot.page.scrollHeight),
            url: `${captureServer.baseUrl}/app${route}`,
            screenshotPath: resolvedScreenshotPath,
          }),
          outputPath: resolvedScreenshotPath,
        });
      } catch (error) {
        if (!(await exists(resolvedScreenshotPath))) {
          throw error;
        }
      }
    }

    const output =
      format === "json"
        ? JSON.stringify(snapshot, null, 2)
        : [
            "Code-to-Design Capture",
            `project: ${projectRoot || "unknown"}`,
            `dist: ${distRoot}`,
            `route: ${route}`,
            `viewportKey: ${viewportKey}`,
            `viewport: ${viewportWidth}x${viewportHeight}`,
            `page: ${snapshot.page.title || "untitled"} ${snapshot.page.scrollWidth}x${snapshot.page.scrollHeight}`,
            `nodes: ${snapshot.summary.nodeCount} (text=${snapshot.summary.textNodeCount}, image=${snapshot.summary.imageNodeCount}, shape=${snapshot.summary.shapeNodeCount})`,
            ...(screenshotOutputPath ? [`screenshot: ${path.resolve(screenshotOutputPath)}`] : []),
          ].join("\n");

    return {
      exitCode: 0,
      output,
      snapshot,
    };
  } finally {
    await captureServer.close().catch(() => {});
  }
}

export async function main(argv = process.argv) {
  try {
    const result = await runCodeToDesignCaptureCli(argv);
    console.log(result.output);
    if (result.exitCode !== 0) {
      process.exitCode = result.exitCode;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "code-to-design capture failed");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
