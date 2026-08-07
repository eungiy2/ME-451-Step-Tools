import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const chromePath = process.argv[2] || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const appUrl = process.argv[3] || "http://127.0.0.1:3001";
const fixturePath = path.resolve(
  process.argv[4] ||
  path.join(
    "node_modules",
    "occt-import-js",
    "test",
    "testfiles",
    "simple-basic-cube",
    "cube.stp"
  )
);
const screenshotPath = path.resolve(
  process.argv[5] || path.join("C:\\occt-topology", "native-topology-browser.png")
);
const expectedCountValues = (process.argv[6] || "6,12,6")
  .split(",")
  .map((value) => Number(value));
assert.equal(
  expectedCountValues.length,
  3,
  "Expected topology counts must use faces,edges,loops"
);
assert.ok(expectedCountValues.every(Number.isFinite), "Expected topology counts must be numeric");
const expectedTopologyCounts = {
  faces: expectedCountValues[0],
  edges: expectedCountValues[1],
  loops: expectedCountValues[2],
};
const runFlags = new Set(process.argv.slice(7));
const loadOnly = runFlags.has("--load-only");
const expectFallback = runFlags.has("--expect-fallback");

assert.ok(fs.existsSync(chromePath), `Missing Chrome executable: ${chromePath}`);
assert.ok(fs.existsSync(fixturePath), `Missing STEP fixture: ${fixturePath}`);

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const debuggingPort = 9300 + (process.pid % 200);
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), "occt-native-browser-"));
const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-popup-blocking",
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
const pending = new Map();
const eventListeners = new Map();
let commandId = 0;

const waitForSocket = new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
await waitForSocket;

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

const waitFor = async (callback, label, timeoutMilliseconds = 30000) => {
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
  browserErrors.push({
    text: exceptionDetails.exception?.description || exceptionDetails.text,
    url: exceptionDetails.url || "",
  });
});
on("Log.entryAdded", ({ entry }) => {
  if (entry.level === "error") {
    browserErrors.push({
      text: entry.text,
      url: entry.url || "",
    });
  }
});
const assertNoRelevantBrowserErrors = () => {
  const relevantBrowserErrors = browserErrors.filter(
    (error) =>
      !error.url.endsWith("/favicon.ico") &&
      !/websocket|hmr|@vite\/client/i.test(`${error.text} ${error.url}`)
  );
  assert.deepEqual(
    relevantBrowserErrors,
    [],
    `Browser errors: ${relevantBrowserErrors
      .map((error) => `${error.text}${error.url ? ` (${error.url})` : ""}`)
      .join("\n")}`
  );
};

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("DOM.enable");
  await send("Log.enable");
  await send("Page.navigate", { url: appUrl });
  await waitFor(
    () => evaluate("document.readyState === 'complete'"),
    "the application document"
  );
  await waitFor(
    () => evaluate("!document.body.innerText.includes('Initializing OCCT kernel')"),
    "OCCT initialization"
  );

  const documentNode = await send("DOM.getDocument", { depth: 2 });
  const fileInput = await send("DOM.querySelector", {
    nodeId: documentNode.root.nodeId,
    selector: "input[type=file]",
  });
  assert.ok(fileInput.nodeId, "STEP file input was not found");
  await send("DOM.setFileInputFiles", {
    nodeId: fileInput.nodeId,
    files: [fixturePath],
  });

  const topologyCounts = await waitFor(
    () => evaluate(`(() => {
      const readCard = (label) => {
        const node = [...document.querySelectorAll("div")]
          .find((element) => element.children.length === 0 && element.textContent.trim() === label);
        return Number(node?.nextElementSibling?.textContent || 0);
      };
      const counts = {
        faces: readCard("Faces"),
        edges: readCard("Edges"),
        loops: readCard("Loops"),
      };
      return counts.faces && counts.edges && counts.loops ? counts : null;
    })()`),
    "parsed topology counts"
  );

  assert.deepEqual(topologyCounts, expectedTopologyCounts);

  const nativeResources = await evaluate(`performance.getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((name) => name.includes("/occt-native/"))`);
  if (expectFallback) {
    assert.deepEqual(
      nativeResources,
      [],
      "Tessellation fallback mode should not request native OCCT assets"
    );
  } else {
    assert.ok(
      nativeResources.some((name) => name.endsWith("/occt-import-js.js")),
      "Native OCCT JavaScript wrapper was not requested"
    );
    assert.ok(
      nativeResources.some((name) => name.endsWith("/occt-import-js.wasm")),
      "Native OCCT WebAssembly module was not requested"
    );
  }

  if (loadOnly) {
    const dimensionLabels = await evaluate(`[...document.querySelectorAll("[data-pmi-tolerance-id]")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          toleranceId: element.dataset.pmiToleranceId,
          datum: element.dataset.pmiAssociatedDatum || "",
          text: element.textContent,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      })`);
    const screenshot = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    assertNoRelevantBrowserErrors();
    console.log(JSON.stringify({
      topologyCounts,
      nativeResources,
      dimensionLabels,
      screenshotPath,
    }, null, 2));
  } else {
  const canvasRect = await evaluate(`(() => {
    const rect = document.querySelector("canvas")?.getBoundingClientRect();
    return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
  })()`);
  assert.ok(canvasRect?.width > 0 && canvasRect?.height > 0, "CAD canvas was not rendered");

  const hoveredEntities = new Map();
  const xStart = Math.round(canvasRect.x + canvasRect.width * 0.08);
  const xEnd = Math.round(canvasRect.x + canvasRect.width * 0.92);
  const yStart = Math.round(canvasRect.y + canvasRect.height * 0.08);
  const yEnd = Math.round(canvasRect.y + canvasRect.height * 0.92);

  const hasFaceAndEdge = () => hoveredEntities.has("face") && hoveredEntities.has("edge");
  for (let y = yStart; y <= yEnd && !hasFaceAndEdge(); y += 18) {
    for (let x = xStart; x <= xEnd && !hasFaceAndEdge(); x += 18) {
      await send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
      });
      await delay(12);
      const hoveredName = await evaluate(`(() => {
        const label = [...document.querySelectorAll("div")]
          .find((element) => element.textContent.trim() === "Hovering Entity_");
        return label?.nextElementSibling?.getAttribute("title") || null;
      })()`);
      if (!hoveredName) continue;
      const kind = hoveredName.includes("Vertex")
        ? "vertex"
        : hoveredName.includes("Edge")
          ? "edge"
          : hoveredName.includes("Face")
            ? "face"
            : null;
      if (kind && !hoveredEntities.has(kind)) hoveredEntities.set(kind, { x, y, name: hoveredName });
    }
  }

  assert.ok(hoveredEntities.has("face"), "No face hover target was found");
  assert.ok(hoveredEntities.has("edge"), "No edge hover target was found");

  const readHoveredName = () => evaluate(`(() => {
    const label = [...document.querySelectorAll("div")]
      .find((element) => element.textContent.trim() === "Hovering Entity_");
    return label?.nextElementSibling?.getAttribute("title") || null;
  })()`);
  const getKind = (name) => name?.includes("Vertex")
    ? "vertex"
    : name?.includes("Edge")
      ? "edge"
      : name?.includes("Face")
        ? "face"
        : null;
  const refineHoverTarget = async (kind, approximate) => {
    const candidates = [];
    for (let offset = -126; offset <= 126; offset += 3) {
      candidates.push({ x: approximate.x + offset, y: approximate.y });
    }
    for (let offset = -126; offset <= 126; offset += 3) {
      candidates.push({ x: approximate.x, y: approximate.y + offset });
    }

    for (const candidate of candidates) {
      if (
        candidate.x < canvasRect.x ||
        candidate.x > canvasRect.x + canvasRect.width ||
        candidate.y < canvasRect.y ||
        candidate.y > canvasRect.y + canvasRect.height
      ) {
        continue;
      }
      await send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: candidate.x,
        y: candidate.y,
      });
      await delay(70);
      const name = await readHoveredName();
      if (getKind(name) === kind) return { ...candidate, name };
    }
    return null;
  };

  const vertexFractions = [
    [0.46, 0.19],
    [0.21, 0.29],
    [0.76, 0.25],
    [0.56, 0.40],
    [0.25, 0.73],
    [0.55, 0.91],
    [0.73, 0.67],
  ];
  let vertexTarget = null;
  for (const [xFraction, yFraction] of vertexFractions) {
    const center = {
      x: canvasRect.x + canvasRect.width * xFraction,
      y: canvasRect.y + canvasRect.height * yFraction,
    };
    for (let dy = -12; dy <= 12 && !vertexTarget; dy += 2) {
      for (let dx = -12; dx <= 12 && !vertexTarget; dx += 2) {
        const candidate = {
          x: Math.round(center.x + dx),
          y: Math.round(center.y + dy),
        };
        await send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: candidate.x,
          y: candidate.y,
        });
        await delay(70);
        const name = await readHoveredName();
        if (getKind(name) === "vertex") vertexTarget = { ...candidate, name };
      }
    }
    if (vertexTarget) break;
  }
  assert.ok(vertexTarget, "No vertex hover target was found");
  hoveredEntities.set("vertex", vertexTarget);

  const clickTarget = await refineHoverTarget("edge", hoveredEntities.get("edge"));
  assert.ok(clickTarget, "The edge hover target could not be stabilized");
  hoveredEntities.set("edge", clickTarget);

  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    clickCount: 1,
    x: clickTarget.x,
    y: clickTarget.y,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    clickCount: 1,
    x: clickTarget.x,
    y: clickTarget.y,
  });

  const selectedEntity = await waitFor(
    () => evaluate(`(() => {
      const header = [...document.querySelectorAll("span")]
        .find((element) => element.textContent.trim() === "Selected B-Rep Entity");
      if (!header) return null;
      const container = header.closest("div.space-y-2");
      return container?.innerText || null;
    })()`),
    "edge selection"
  );
  assert.ok(selectedEntity.includes("EDGE"), `Expected an edge selection:\n${selectedEntity}`);
  const selectedTopologySources = await evaluate(`[...document.querySelectorAll("span")]
    .filter((element) => element.textContent.trim() === "Topology:")
    .map((element) => element.nextElementSibling?.textContent.trim())
    .filter(Boolean)`);
  assert.ok(
    expectFallback
      ? selectedTopologySources.some((source) =>
          source === "Native STEP" || source === "Tessellation fallback"
        ) && !selectedTopologySources.includes("Native OCCT")
      : selectedTopologySources.includes("Native OCCT"),
    `Unexpected edge topology metadata: ${selectedTopologySources.join(", ")}`
  );

  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    clickCount: 1,
    x: Math.round(canvasRect.x + 8),
    y: Math.round(canvasRect.y + canvasRect.height - 8),
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    clickCount: 1,
    x: Math.round(canvasRect.x + 8),
    y: Math.round(canvasRect.y + canvasRect.height - 8),
  });
  await waitFor(
    () => evaluate("!document.body.innerText.includes('Selected B-Rep Entity')"),
    "blank-space selection clearing"
  );

  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: vertexTarget.x,
    y: vertexTarget.y,
  });
  await delay(80);
  assert.equal(getKind(await readHoveredName()), "vertex", "Vertex hover did not remain stable");
  const readSelectedEntity = () => evaluate(`(() => {
      const header = [...document.querySelectorAll("span")]
        .find((element) => element.textContent.trim() === "Selected B-Rep Entity");
      if (!header) return null;
      const container = header.closest("div.space-y-2");
      return container?.innerText || null;
    })()`);
  const vertexClickOffsets = [
    [0, 0],
    [-2, 0],
    [2, 0],
    [0, -2],
    [0, 2],
    [-2, -2],
    [2, -2],
    [-2, 2],
    [2, 2],
  ];
  let selectedVertex = null;
  const vertexClickAttempts = [];
  for (const [dx, dy] of vertexClickOffsets) {
    const x = vertexTarget.x + dx;
    const y = vertexTarget.y + dy;
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await delay(80);
    const hoveredName = await readHoveredName();
    if (getKind(hoveredName) !== "vertex") continue;
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      x,
      y,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      x,
      y,
    });
    await delay(150);
    const selected = await readSelectedEntity();
    vertexClickAttempts.push({ dx, dy, hoveredName, selected });
    if (selected?.includes("VERTEX")) {
      selectedVertex = selected;
      break;
    }
  }
  assert.ok(
    selectedVertex,
    `Stable native vertex hover did not produce a vertex selection: ${JSON.stringify(vertexClickAttempts)}`
  );
  assert.ok(selectedVertex.includes("VERTEX"), `Expected a vertex selection:\n${selectedVertex}`);
  const vertexTopologySources = await evaluate(`[...document.querySelectorAll("span")]
    .filter((element) => element.textContent.trim() === "Topology:")
    .map((element) => element.nextElementSibling?.textContent.trim())
    .filter(Boolean)`);
  assert.ok(
    expectFallback
      ? vertexTopologySources.some((source) =>
          source === "Native STEP" || source === "Tessellation fallback"
        ) && !vertexTopologySources.includes("Native OCCT")
      : vertexTopologySources.includes("Native OCCT"),
    `Unexpected vertex topology metadata: ${vertexTopologySources.join(", ")}`
  );

  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    clickCount: 1,
    x: Math.round(canvasRect.x + 8),
    y: Math.round(canvasRect.y + canvasRect.height - 8),
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    clickCount: 1,
    x: Math.round(canvasRect.x + 8),
    y: Math.round(canvasRect.y + canvasRect.height - 8),
  });
  await waitFor(
    () => evaluate("!document.body.innerText.includes('Selected B-Rep Entity')"),
    "blank-space clearing after vertex selection"
  );

  const screenshot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  assertNoRelevantBrowserErrors();
  console.log(JSON.stringify({
    topologyCounts,
    nativeResources,
    hoveredEntities: Object.fromEntries(hoveredEntities),
    screenshotPath,
  }, null, 2));
  }
} finally {
  socket.close();
  chrome.kill();
  await delay(100);
  fs.rmSync(profilePath, { recursive: true, force: true });
}
