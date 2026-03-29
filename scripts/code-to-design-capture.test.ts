import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCaptureInjectionScript,
  buildChromeArgs,
  extractCapturePayloadFromDom,
  guessChromeBinary,
  injectCapturePayloadIntoHtml,
} from "./code-to-design-capture.js";

test("buildCaptureInjectionScript emits payload and error anchors", () => {
  const html = buildCaptureInjectionScript();
  assert.match(html, /autodesign-capture-payload/);
  assert.match(html, /autodesign-capture-error/);
  assert.match(html, /autodesign-capture-bootstrap/);
  assert.match(html, /isCaptureHelper/);
});

test("injectCapturePayloadIntoHtml appends the capture script before closing body", () => {
  const html = injectCapturePayloadIntoHtml("<html><body><main>page</main></body></html>");
  assert.match(html, /<main>page<\/main>/);
  assert.match(html, /autodesign-capture-payload/);
  assert.match(html, /<\/script>\n<\/body>/);
});

test("extractCapturePayloadFromDom parses embedded JSON payloads", () => {
  const payload = extractCapturePayloadFromDom(`
    <html>
      <body>
        <script type="application/json" id="autodesign-capture-payload">{"page":{"title":"AItest","urlPath":"/","scrollWidth":1440,"scrollHeight":2200,"backgroundColor":"rgb(1, 1, 1)","backgroundImage":"none"},"nodes":[]}</script>
      </body>
    </html>
  `);

  assert.equal(payload.page.title, "AItest");
  assert.deepEqual(payload.nodes, []);
});

test("buildChromeArgs enables headless capture modes with a stable window size", () => {
  const args = buildChromeArgs({
    userDataDir: "/tmp/autodesign",
    width: 1440,
    height: 2200,
    url: "http://127.0.0.1:3123/__autodesign__/capture",
    dumpDom: true,
    screenshotPath: "/tmp/page.png",
  });

  assert.equal(args.includes("--headless=new"), true);
  assert.equal(args.includes("--dump-dom"), true);
  assert.equal(args.includes("--window-size=1440,2200"), true);
  assert.equal(args.includes("--screenshot=/tmp/page.png"), true);
});

test("guessChromeBinary prefers an explicit existing binary path", async () => {
  const chromeBinary = await guessChromeBinary(process.execPath);
  assert.equal(chromeBinary, process.execPath);
});
