/**
 * Node-only helpers for graph-export scripts: load the locally installed
 * `occt-import-js` (standard tessellation wrapper) with a filesystem
 * locateFile, so scripts run offline without the browser build or the CDN.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function loadLocalOcct() {
  const occtModule = await import("occt-import-js");
  const factory = occtModule.default || occtModule;
  if (typeof factory !== "function") {
    throw new Error("occt-import-js does not expose an emscripten factory");
  }
  return factory({
    locateFile: (name: string) =>
      pathToFileURL(path.resolve("node_modules", "occt-import-js", "dist", name)).toString(),
  });
}

/**
 * Resolve an OCCT wrapper for Node. The default published wrapper in
 * `public/occt-native/` is a browser-global build and is not Node-importable,
 * so only an explicit path (argv or `OCCT_WRAPPER_PATH`) opts into native
 * topology. Without one, scripts use `loadLocalOcct()` (standard tessellation
 * wrapper, local wasm) and run fully offline.
 */
export function resolveOcctForNode(wrapperPath?: string) {
  const explicit = wrapperPath || process.env.OCCT_WRAPPER_PATH;
  if (explicit) {
    return { nativeWrapperUrl: pathToFileURL(path.resolve(explicit)).toString() };
  }
  return { nativeWrapperUrl: undefined };
}