import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const chromePath = process.argv[2] || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const outputPath = path.resolve(
  process.argv[3] || path.join("C:\\occt-topology", "topology-browser-benchmark.json")
);

const modes = [
  { name: "fallback", url: "http://127.0.0.1:3002" },
  { name: "native", url: "http://127.0.0.1:3001" },
];
const fixtures = [
  {
    name: "CTC 01",
    path: path.resolve(
      "STEP samples with PMI",
      "AP242",
      "nist_ctc_01_asme1_ap242-e1.stp"
    ),
  },
  {
    name: "FTC 06",
    path: path.resolve(
      "STEP samples with PMI",
      "AP242",
      "nist_ftc_06_asme1_ap242-e2.stp"
    ),
  },
  {
    name: "FTC 07",
    path: path.resolve(
      "STEP samples with PMI",
      "AP242",
      "nist_ftc_07_asme1_ap242-e2.stp"
    ),
  },
];

assert.ok(fs.existsSync(chromePath), `Missing Chrome executable: ${chromePath}`);
fixtures.forEach((fixture) => {
  assert.ok(fs.existsSync(fixture.path), `Missing STEP fixture: ${fixture.path}`);
});

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const round = (value, digits = 2) => Number(value.toFixed(digits));
const percentile = (values, ratio) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
};

const launchBrowser = async (debuggingPort) => {
  const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), "occt-benchmark-"));
  const process = spawn(chromePath, [
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

  const endpoint = `http://127.0.0.1:${debuggingPort}/json`;
  let target;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const targets = await fetch(endpoint).then((response) => response.json());
      target = targets.find((candidate) => candidate.type === "page");
      if (target?.webSocketDebuggerUrl) break;
    } catch {
      // Chrome may not have opened the debugging socket yet.
    }
    await delay(100);
  }
  if (!target?.webSocketDebuggerUrl) {
    process.kill();
    throw new Error("Chrome DevTools endpoint did not become available");
  }

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let commandId = 0;
  const pending = new Map();
  const eventListeners = new Map();
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
  const close = async () => {
    socket.close();
    process.kill();
    await delay(100);
    fs.rmSync(profilePath, { recursive: true, force: true });
  };
  return { send, on, close };
};

const toMetricMap = (result) =>
  Object.fromEntries((result.metrics || []).map((metric) => [metric.name, metric.value]));

const metricDelta = (before, after, name, scale = 1) =>
  round(((after[name] || 0) - (before[name] || 0)) * scale, 3);

const benchmarkRun = async (mode, fixture, runIndex) => {
  const debuggingPort = 9500 + ((process.pid + runIndex * 17) % 300);
  const browser = await launchBrowser(debuggingPort);
  const browserErrors = [];
  browser.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    browserErrors.push({
      text: exceptionDetails.exception?.description || exceptionDetails.text,
      url: exceptionDetails.url || "",
    });
  });
  browser.on("Log.entryAdded", ({ entry }) => {
    if (entry.level === "error") {
      browserErrors.push({ text: entry.text, url: entry.url || "" });
    }
  });

  const evaluate = async (expression) => {
    const result = await browser.send("Runtime.evaluate", {
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
  const readPerformanceMetrics = async () =>
    toMetricMap(await browser.send("Performance.getMetrics"));

  try {
    await browser.send("Page.enable");
    await browser.send("Runtime.enable");
    await browser.send("DOM.enable");
    await browser.send("Log.enable");
    await browser.send("Performance.enable");

    const navigationStartedAt = Date.now();
    await browser.send("Page.navigate", { url: mode.url });
    await waitFor(
      () => evaluate("document.readyState === 'complete'"),
      "the application document"
    );
    await waitFor(
      () => evaluate("!document.body.innerText.includes('Initializing OCCT kernel')"),
      "OCCT initialization"
    );
    const kernelReadyMilliseconds = Date.now() - navigationStartedAt;

    const resourcesBeforeUpload = await evaluate(
      `performance.getEntriesByType("resource").map((entry) => entry.name)`
    );
    if (mode.name === "native") {
      assert.ok(
        resourcesBeforeUpload.some((name) => name.includes("/occt-native/occt-import-js.wasm")),
        "Native benchmark did not load the native WASM module"
      );
    } else {
      assert.ok(
        !resourcesBeforeUpload.some((name) => name.includes("/occt-native/")),
        "Fallback benchmark unexpectedly loaded native OCCT assets"
      );
    }

    const documentNode = await browser.send("DOM.getDocument", { depth: 2 });
    const fileInput = await browser.send("DOM.querySelector", {
      nodeId: documentNode.root.nodeId,
      selector: "input[type=file]",
    });
    assert.ok(fileInput.nodeId, "STEP file input was not found");

    await browser.send("HeapProfiler.collectGarbage");
    const beforeLoadMetrics = await readPerformanceMetrics();
    const loadStartedAt = await evaluate("performance.now()");
    await browser.send("DOM.setFileInputFiles", {
      nodeId: fileInput.nodeId,
      files: [fixture.path],
    });

    const topologyCounts = await waitFor(
      () => evaluate(`(() => {
        const readCard = (label) => {
          const node = [...document.querySelectorAll("div")]
            .find((element) => element.children.length === 0 && element.textContent.trim() === label);
          return Number(node?.nextElementSibling?.textContent || 0);
        };
        const activeSource = ${JSON.stringify(path.basename(fixture.path))};
        const counts = {
          faces: readCard("Faces"),
          edges: readCard("Edges"),
          loops: readCard("Loops"),
        };
        const ready = document.body.innerText.includes(activeSource) &&
          !document.body.innerText.includes("Tessellating Mesh...") &&
          counts.faces > 0 && counts.edges > 0 && counts.loops > 0;
        return ready ? counts : null;
      })()`),
      `${fixture.name} topology`
    );
    await delay(500);
    const loadFinishedAt = await evaluate("performance.now()");
    await browser.send("HeapProfiler.collectGarbage");
    const afterLoadMetrics = await readPerformanceMetrics();

    const canvasRect = await evaluate(`(() => {
      const rect = document.querySelector("canvas")?.getBoundingClientRect();
      return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
    })()`);
    assert.ok(canvasRect?.width > 0 && canvasRect?.height > 0, "CAD canvas was not rendered");

    await evaluate(`(() => {
      window.__occtBenchmarkFrames = [];
      const endAt = performance.now() + 1700;
      const sample = (timestamp) => {
        window.__occtBenchmarkFrames.push(timestamp);
        if (performance.now() < endAt) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    })()`);
    await delay(100);
    const beforeOrbitMetrics = await readPerformanceMetrics();
    const orbitStartedAt = Date.now();
    const centerX = canvasRect.x + canvasRect.width * 0.5;
    const centerY = canvasRect.y + canvasRect.height * 0.5;
    await browser.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: centerX,
      y: centerY,
    });
    await browser.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      x: centerX,
      y: centerY,
    });
    for (let step = 1; step <= 48; step++) {
      const progress = step / 48;
      await browser.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        button: "left",
        buttons: 1,
        x: centerX + Math.sin(progress * Math.PI) * 170,
        y: centerY + Math.sin(progress * Math.PI * 2) * 55,
      });
      await delay(12);
    }
    await browser.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      x: centerX,
      y: centerY,
    });
    await delay(900);
    const orbitWallMilliseconds = Date.now() - orbitStartedAt;
    const afterOrbitMetrics = await readPerformanceMetrics();
    const frameTimestamps = await evaluate("window.__occtBenchmarkFrames || []");
    const frameIntervals = frameTimestamps
      .slice(1)
      .map((timestamp, index) => timestamp - frameTimestamps[index])
      .filter((interval) => interval > 0 && interval < 1000);

    const relevantBrowserErrors = browserErrors.filter(
      (error) =>
        !error.url.endsWith("/favicon.ico") &&
        !/websocket|hmr/i.test(`${error.text} ${error.url}`)
    );
    assert.deepEqual(
      relevantBrowserErrors,
      [],
      `Browser errors: ${relevantBrowserErrors.map((error) => error.text).join("\n")}`
    );

    return {
      mode: mode.name,
      fixture: fixture.name,
      fileName: path.basename(fixture.path),
      fileBytes: fs.statSync(fixture.path).size,
      kernelReadyMilliseconds,
      loadMilliseconds: round(loadFinishedAt - loadStartedAt),
      topologyCounts,
      loadMetrics: {
        taskMilliseconds: metricDelta(beforeLoadMetrics, afterLoadMetrics, "TaskDuration", 1000),
        scriptMilliseconds: metricDelta(beforeLoadMetrics, afterLoadMetrics, "ScriptDuration", 1000),
        heapMegabytes: round((afterLoadMetrics.JSHeapUsedSize || 0) / 1024 / 1024),
        heapDeltaMegabytes: round(
          ((afterLoadMetrics.JSHeapUsedSize || 0) - (beforeLoadMetrics.JSHeapUsedSize || 0)) /
          1024 /
          1024
        ),
        nodes: Math.round(afterLoadMetrics.Nodes || 0),
      },
      orbitMetrics: {
        wallMilliseconds: orbitWallMilliseconds,
        taskMilliseconds: metricDelta(beforeOrbitMetrics, afterOrbitMetrics, "TaskDuration", 1000),
        scriptMilliseconds: metricDelta(beforeOrbitMetrics, afterOrbitMetrics, "ScriptDuration", 1000),
        frameSamples: frameIntervals.length,
        averageFrameMilliseconds: round(
          frameIntervals.reduce((sum, interval) => sum + interval, 0) /
          Math.max(frameIntervals.length, 1)
        ),
        p95FrameMilliseconds: round(percentile(frameIntervals, 0.95)),
        droppedFrames: frameIntervals.filter((interval) => interval > 25).length,
      },
      resources: resourcesBeforeUpload.filter(
        (name) => name.includes("occt-import-js") || name.includes("occt-native")
      ),
    };
  } finally {
    await browser.close();
  }
};

const results = [];
let runIndex = 0;
for (const fixture of fixtures) {
  for (const mode of modes) {
    const result = await benchmarkRun(mode, fixture, runIndex++);
    results.push(result);
    console.log(
      `${result.fixture} ${result.mode}: load ${result.loadMilliseconds} ms, ` +
      `${result.topologyCounts.edges} edges, orbit p95 ${result.orbitMetrics.p95FrameMilliseconds} ms`
    );
  }
}

const comparisons = fixtures.map((fixture) => {
  const fallback = results.find(
    (result) => result.fixture === fixture.name && result.mode === "fallback"
  );
  const native = results.find(
    (result) => result.fixture === fixture.name && result.mode === "native"
  );
  assert.ok(fallback && native, `Missing benchmark pair for ${fixture.name}`);
  return {
    fixture: fixture.name,
    loadDeltaPercent: round(
      ((native.loadMilliseconds - fallback.loadMilliseconds) /
        fallback.loadMilliseconds) *
      100
    ),
    edgeDelta: native.topologyCounts.edges - fallback.topologyCounts.edges,
    retainedHeapDeltaMegabytes: round(
      native.loadMetrics.heapMegabytes - fallback.loadMetrics.heapMegabytes
    ),
    orbitP95DeltaMilliseconds: round(
      native.orbitMetrics.p95FrameMilliseconds -
      fallback.orbitMetrics.p95FrameMilliseconds
    ),
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  chromePath,
  modes,
  results,
  comparisons,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

comparisons.forEach((comparison) => {
  console.log(
    `${comparison.fixture} native delta: load ${comparison.loadDeltaPercent}%, ` +
    `edges ${comparison.edgeDelta >= 0 ? "+" : ""}${comparison.edgeDelta}, ` +
    `heap ${comparison.retainedHeapDeltaMegabytes} MB, ` +
    `orbit p95 ${comparison.orbitP95DeltaMilliseconds} ms`
  );
});
console.log(`Benchmark report written to ${outputPath}`);
