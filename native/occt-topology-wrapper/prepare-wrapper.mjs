import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const wrapperRoot = path.dirname(fileURLToPath(import.meta.url));
const upstreamRoot = process.argv[2] ? path.resolve(process.argv[2]) : null;

if (!upstreamRoot) {
  throw new Error("Usage: node prepare-wrapper.mjs <occt-import-js checkout>");
}

const packageJsonPath = path.join(upstreamRoot, "package.json");
const sourceRoot = path.join(upstreamRoot, "occt-import-js", "src");
if (!fs.existsSync(packageJsonPath) || !fs.existsSync(sourceRoot)) {
  throw new Error(`Not an occt-import-js source checkout: ${upstreamRoot}`);
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
if (packageJson.version !== "0.0.23") {
  throw new Error(
    `Unsupported occt-import-js version ${packageJson.version}; expected 0.0.23`
  );
}

const readSource = (fileName) =>
  fs.readFileSync(path.join(sourceRoot, fileName), "utf8").replace(/\r\n/g, "\n");

const writeSource = (fileName, source) =>
  fs.writeFileSync(path.join(sourceRoot, fileName), source, "utf8");

const countOccurrences = (source, value) => source.split(value).length - 1;
const importerHeaderBeforePreparation = readSource("importer.hpp");
const brepSourceBeforePreparation = readSource("importer-brep.cpp");
const xcafSourceBeforePreparation = readSource("importer-xcaf.cpp");
const jsInterfaceBeforePreparation = readSource("js-interface.cpp");
const exporterExists = fs.existsSync(
  path.join(sourceRoot, "native-topology-export.cpp")
);
const preparationCounts = {
  interface: countOccurrences(
    importerHeaderBeforePreparation,
    "virtual const TopoDS_Shape& GetShape () const = 0;"
  ),
  brep: countOccurrences(
    brepSourceBeforePreparation,
    "virtual const TopoDS_Shape& GetShape () const override"
  ),
  xcaf: countOccurrences(
    xcafSourceBeforePreparation,
    "virtual const TopoDS_Shape& GetShape () const override"
  ),
  writer: countOccurrences(
    jsInterfaceBeforePreparation,
    "WriteNativeTopology (mesh.GetShape (), meshObj, mParams);"
  ),
};
const alreadyPrepared =
  exporterExists
  && preparationCounts.interface === 1
  && preparationCounts.brep === 2
  && preparationCounts.xcaf === 2
  && preparationCounts.writer === 1;

if (alreadyPrepared) {
  for (const fileName of ["native-topology-export.hpp", "native-topology-export.cpp"]) {
    fs.copyFileSync(
      path.join(wrapperRoot, "src", fileName),
      path.join(sourceRoot, fileName)
    );
  }
  console.log(`Native-topology wrapper source is already prepared at ${upstreamRoot}`);
  process.exit(0);
}

if (
  exporterExists
  || Object.values(preparationCounts).some((count) => count !== 0)
) {
  throw new Error(
    `Partially prepared native-topology wrapper source at ${upstreamRoot}; ` +
    "restore the upstream files before retrying"
  );
}

const replaceExactly = (source, search, replacement, expectedCount, label) => {
  const actualCount = source.split(search).length - 1;
  if (actualCount !== expectedCount) {
    throw new Error(
      `Unable to prepare ${label}: expected ${expectedCount} anchors, found ${actualCount}`
    );
  }
  return source.split(search).join(replacement);
};

let importerHeader = readSource("importer.hpp");
importerHeader = replaceExactly(
  importerHeader,
  "#include <functional>\n",
  "#include <functional>\n\n#include <TopoDS_Shape.hxx>\n",
  1,
  "importer.hpp include"
);
importerHeader = replaceExactly(
  importerHeader,
  "    virtual void EnumerateFaces (const std::function<void (const Face& face)>& onFace) const = 0;\n",
  "    virtual void EnumerateFaces (const std::function<void (const Face& face)>& onFace) const = 0;\n" +
    "    virtual const TopoDS_Shape& GetShape () const = 0;\n",
  1,
  "Mesh shape accessor"
);
writeSource("importer.hpp", importerHeader);

const addShapeAccessorToClass = (source, fileName, className) => {
  const classStart = source.indexOf(`class ${className} : public Mesh`);
  if (classStart < 0) {
    throw new Error(`Unable to prepare ${fileName}: missing ${className}`);
  }
  const classEnd = source.indexOf("\n};", classStart);
  if (classEnd < 0) {
    throw new Error(`Unable to prepare ${fileName}: incomplete ${className}`);
  }

  const classSource = source.slice(classStart, classEnd);
  const preparedClass = replaceExactly(
    classSource,
    "\nprivate:\n    const TopoDS_Shape& shape;",
    "\n" +
      "    virtual const TopoDS_Shape& GetShape () const override\n" +
      "    {\n" +
      "        return shape;\n" +
      "    }\n\n" +
      "private:\n" +
      "    const TopoDS_Shape& shape;",
    1,
    `${fileName} ${className} shape accessor`
  );
  return source.slice(0, classStart) + preparedClass + source.slice(classEnd);
};

const addShapeAccessors = (fileName, classNames) => {
  let source = readSource(fileName);
  classNames.forEach((className) => {
    source = addShapeAccessorToClass(source, fileName, className);
  });
  writeSource(fileName, source);
};

addShapeAccessors("importer-brep.cpp", [
  "BrepShapeMesh",
  "BrepStandaloneFacesMesh",
]);
addShapeAccessors("importer-xcaf.cpp", [
  "XcafShapeMesh",
  "XcafStandaloneFacesMesh",
]);

let jsInterface = readSource("js-interface.cpp");
jsInterface = replaceExactly(
  jsInterface,
  '#include "importer-brep.hpp"\n',
  '#include "importer-brep.hpp"\n#include "native-topology-export.hpp"\n',
  1,
  "js-interface exporter include"
);
jsInterface = replaceExactly(
  jsInterface,
  "    HierarchyWriter (emscripten::val& meshesArr) :\n" +
    "        mMeshesArr (meshesArr),\n" +
    "        mMeshCount (0)\n",
  "    HierarchyWriter (emscripten::val& meshesArr, const ImportParams& params) :\n" +
    "        mMeshesArr (meshesArr),\n" +
    "        mParams (params),\n" +
    "        mMeshCount (0)\n",
  1,
  "HierarchyWriter constructor"
);
jsInterface = replaceExactly(
  jsInterface,
  '            meshObj.set ("brep_faces", brepFaceArr);\n',
  '            meshObj.set ("brep_faces", brepFaceArr);\n' +
    "            WriteNativeTopology (mesh.GetShape (), meshObj, mParams);\n",
  1,
  "mesh topology export"
);
jsInterface = replaceExactly(
  jsInterface,
  "    emscripten::val& mMeshesArr;\n    int mMeshCount;\n",
  "    emscripten::val& mMeshesArr;\n" +
    "    const ImportParams& mParams;\n" +
    "    int mMeshCount;\n",
  1,
  "HierarchyWriter parameters"
);
jsInterface = replaceExactly(
  jsInterface,
  "    HierarchyWriter hierarchyWriter (meshesArr);\n",
  "    HierarchyWriter hierarchyWriter (meshesArr, params);\n",
  1,
  "HierarchyWriter construction"
);
writeSource("js-interface.cpp", jsInterface);

for (const fileName of ["native-topology-export.hpp", "native-topology-export.cpp"]) {
  fs.copyFileSync(
    path.join(wrapperRoot, "src", fileName),
    path.join(sourceRoot, fileName)
  );
}

console.log(`Prepared native-topology wrapper source at ${upstreamRoot}`);
