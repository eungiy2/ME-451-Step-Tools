import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const wrapperRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(wrapperRoot, "..", "..");
const installedSource = path.join(projectRoot, "node_modules", "occt-import-js");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "occt-topology-wrapper-"));

try {
  fs.cpSync(
    path.join(installedSource, "occt-import-js"),
    path.join(temporaryRoot, "occt-import-js"),
    { recursive: true }
  );
  fs.copyFileSync(
    path.join(installedSource, "package.json"),
    path.join(temporaryRoot, "package.json")
  );

  const preparation = spawnSync(
    process.execPath,
    [path.join(wrapperRoot, "prepare-wrapper.mjs"), temporaryRoot],
    { encoding: "utf8" }
  );
  assert.equal(
    preparation.status,
    0,
    preparation.stderr || preparation.stdout || "Wrapper preparation failed"
  );

  const sourceRoot = path.join(temporaryRoot, "occt-import-js", "src");
  const importerHeader = fs.readFileSync(path.join(sourceRoot, "importer.hpp"), "utf8");
  const jsInterface = fs.readFileSync(path.join(sourceRoot, "js-interface.cpp"), "utf8");
  const exporter = fs.readFileSync(
    path.join(sourceRoot, "native-topology-export.cpp"),
    "utf8"
  );

  assert.match(importerHeader, /virtual const TopoDS_Shape& GetShape \(\) const = 0/);
  assert.match(jsInterface, /WriteNativeTopology \(mesh\.GetShape \(\), meshObj, mParams\)/);
  assert.match(exporter, /meshObject\.set \("brep_vertices", vertices\)/);
  assert.match(exporter, /meshObject\.set \("brep_edges", edges\)/);
  assert.match(exporter, /meshObject\.set \("brep_loops", loops\)/);
  assert.match(exporter, /meshObject\.set \("topology_source", "occt"\)/);

  console.log("OCCT native-topology wrapper preparation verified.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
