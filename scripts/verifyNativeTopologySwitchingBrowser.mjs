import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const chromePath = process.argv[2] || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const appUrl = process.argv[3] || "http://127.0.0.1:3000";
const outputPath = path.resolve(
  process.argv[4] || "C:\\occt-topology\\native-topology-switching.json"
);
const fixtures = [
  {
    name: "CTC 01",
    path: path.resolve("STEP samples with PMI/AP242/nist_ctc_01_asme1_ap242-e1.stp"),
    counts: { faces: 117, edges: 318, loops: 140 },
  },
  {
    name: "FTC 06",
    path: path.resolve("STEP samples with PMI/AP242/nist_ftc_06_asme1_ap242-e2.stp"),
    counts: { faces: 187, edges: 476, loops: 226 },
  },
  {
    name: "FTC 07",
    path: path.resolve("STEP samples with PMI/AP242/nist_ftc_07_asme1_ap242-e2.stp"),
    counts: { faces: 304, edges: 880, loops: 353 },
  },
];
assert.ok(fs.existsSync(chromePath), `Missing Chrome executable: ${chromePath}`);
fixtures.forEach((fixture) => {
  assert.ok(fs.existsSync(fixture.path), `Missing STEP fixture: ${fixture.path}`);
});

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const debuggingPort = 9700 + (process.pid % 200);
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), "occt-switching-browser-"));
const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-popup-blocking",
  "--enable-precise-memory-info",
  "--enable-unsafe-swiftshader",
  "--no-first-run",
  `--remote-debugging-port=${debuggingPort}`,
  `--user-data-dir=${profilePath}`,
  "--window-size=1440,1000",
  "about:blank",
], {
  stdio: "ignore",
});

const waitForDebugTarget = async () => {
  const endpoint = `http://127.0.0.1:${debuggingPort}/json`;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const targets = await fetch(endpoint).then((response) => response.json());
      const page = targets.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Chrome may not have opened its debugging socket yet.
    }
    await delay(100);
  }
  throw new Error("Chrome DevTools endpoint did not become available");
};

const target = await waitForDebugTarget();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

const pending = new Map();
const eventListeners = new Map();
let commandId = 0;
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
    return;
  }
  (eventListeners.get(message.method) || []).forEach((listener) => {
    listener(message.params);
  });
});

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++commandId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const on = (method, listener) => {
  const listeners = eventListeners.get(method) || [];
  listeners.push(listener);
  eventListeners.set(method, listeners);
};
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Browser evaluation failed");
  }
  return result.result.value;
};
const waitFor = async (callback, label, timeoutMilliseconds = 60000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMilliseconds) {
    const value = await callback();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const browserErrors = [];
on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
  browserErrors.push(exceptionDetails.exception?.description || exceptionDetails.text);
});
on("Log.entryAdded", ({ entry }) => {
  if (entry.level === "error" && !/favicon/i.test(`${entry.text} ${entry.url || ""}`)) {
    browserErrors.push(entry.text);
  }
});

const readTopologyCountsExpression = `(() => {
  const readCard = (label) => {
    const node = [...document.querySelectorAll("div")]
      .find((element) => element.children.length === 0 && element.textContent.trim() === label);
    return Number(node?.nextElementSibling?.textContent || 0);
  };
  return {
    faces: readCard("Faces"),
    edges: readCard("Edges"),
    loops: readCard("Loops"),
  };
})()`;

const clickInspectorTab = async (label) => {
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll("button")]
      .find((element) => element.textContent.trim() === ${JSON.stringify(label)});
    button?.click();
    return !!button;
  })()`);
  assert.equal(clicked, true, `Inspector tab ${label} was not found`);
  await delay(50);
};

const loadFixture = async (fixture, cycle) => {
  await clickInspectorTab("B-Rep");
  const documentNode = await send("DOM.getDocument", { depth: 2 });
  const fileInput = await send("DOM.querySelector", {
    nodeId: documentNode.root.nodeId,
    selector: "input[type=file]",
  });
  assert.ok(fileInput.nodeId, "STEP file input was not found");
  await send("DOM.setFileInputFiles", {
    nodeId: fileInput.nodeId,
    files: [fixture.path],
  });

  const counts = await waitFor(async () => {
    const currentCounts = await evaluate(readTopologyCountsExpression);
    const activeFile = await evaluate(
      `document.body.innerText.includes(${JSON.stringify(path.basename(fixture.path))})`
    );
    const ready = activeFile &&
      !await evaluate("document.body.innerText.includes('Tessellating Mesh...')") &&
      Object.entries(fixture.counts).every(([key, value]) => currentCounts[key] === value);
    return ready ? currentCounts : null;
  }, `${fixture.name} cycle ${cycle} topology`);
  await delay(250);

  const pmiLabelCount = await evaluate(
    "document.querySelectorAll('[data-pmi-dimension-label=true]').length"
  );
  const topologyFooter = await evaluate(
    "document.body.innerText.includes('Native topology active')"
  );
  assert.equal(topologyFooter, true, `${fixture.name} did not remain in native topology mode`);

  await send("HeapProfiler.collectGarbage");
  const heap = await send("Runtime.getHeapUsage");
  return {
    fixture: fixture.name,
    cycle,
    counts,
    pmiLabelCount,
    usedHeapBytes: heap.usedSize,
  };
};

const results = [];
try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("DOM.enable");
  await send("Log.enable");
  await send("HeapProfiler.enable");
  await send("Page.navigate", { url: appUrl });
  await waitFor(() => evaluate("document.readyState === 'complete'"), "application document");
  await waitFor(
    () => evaluate("!document.body.innerText.includes('Initializing OCCT kernel')"),
    "OCCT initialization"
  );

  const resources = await evaluate(
    "performance.getEntriesByType('resource').map((entry) => entry.name)"
  );
  assert.ok(
    resources.some((name) => name.endsWith("/occt-native/occt-import-js.wasm")),
    "Native OCCT WebAssembly asset was not loaded"
  );

  for (let cycle = 1; cycle <= 2; cycle++) {
    for (const fixture of fixtures) {
      const result = await loadFixture(fixture, cycle);
      results.push(result);
    }
  }

  fixtures.forEach((fixture) => {
    const [first, second] = results.filter((result) => result.fixture === fixture.name);
    assert.equal(
      second.pmiLabelCount,
      first.pmiLabelCount,
      `${fixture.name} accumulated dimensional PMI labels`
    );
    const allowedHeapGrowth = Math.max(8 * 1024 * 1024, first.usedHeapBytes * 0.15);
    assert.ok(
      second.usedHeapBytes - first.usedHeapBytes <= allowedHeapGrowth,
      `${fixture.name} retained excessive heap between cycles`
    );
  });
  assert.deepEqual(browserErrors, [], `Browser errors:\n${browserErrors.join("\n")}`);

  const report = {
    appUrl,
    cycles: 2,
    fixtures: fixtures.map((fixture) => fixture.name),
    results,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  socket.close();
  chrome.kill();
  await delay(100);
  fs.rmSync(profilePath, { recursive: true, force: true });
}
