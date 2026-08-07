// Resilient Open Cascade WebAssembly loader with native topology and reconstruction fallback.
const OCCT_VERSION = "0.0.23";
const STANDARD_WASM_BASE_URL = `https://unpkg.com/occt-import-js@${OCCT_VERSION}/dist/`;
const DEFAULT_NATIVE_WRAPPER_URL = "/occt-native/occt-import-js.js";

export type OcctTopologyMode = "tessellation" | "native";

export interface OcctLoadOptions {
  topologyMode?: OcctTopologyMode;
  nativeWrapperUrl?: string;
}

type OcctFactory = (options: {
  locateFile: (name: string) => string;
}) => Promise<any>;

type ImportMetaWithEnv = ImportMeta & {
  env?: Record<string, string | undefined>;
};

let standardOcctPromise: Promise<any> | null = null;
const nativeOcctPromises = new Map<string, Promise<any>>();
const nativeScriptPromises = new Map<string, Promise<OcctFactory>>();

const getEnvironment = () => (import.meta as ImportMetaWithEnv).env;

export function getConfiguredOcctLoadOptions(): Required<OcctLoadOptions> {
  const environment = getEnvironment();
  return {
    topologyMode: environment?.VITE_OCCT_TOPOLOGY_MODE === "tessellation"
      ? "tessellation"
      : "native",
    nativeWrapperUrl:
      environment?.VITE_OCCT_NATIVE_WRAPPER_URL?.trim() || DEFAULT_NATIVE_WRAPPER_URL,
  };
}

export const resolveOcctLoadOptions = (
  options: OcctLoadOptions = {}
): Required<OcctLoadOptions> => {
  const configured = getConfiguredOcctLoadOptions();
  return {
    topologyMode: options.topologyMode ?? configured.topologyMode,
    nativeWrapperUrl: options.nativeWrapperUrl?.trim() || configured.nativeWrapperUrl,
  };
};

const getSiblingAssetUrl = (moduleUrl: string, name: string) => {
  try {
    return new URL(name, moduleUrl).toString();
  } catch {
    const separatorIndex = Math.max(
      moduleUrl.lastIndexOf("/"),
      moduleUrl.lastIndexOf("\\")
    );
    return `${separatorIndex >= 0 ? moduleUrl.slice(0, separatorIndex + 1) : ""}${name}`;
  }
};

const loadNativeBrowserFactory = (moduleUrl: string): Promise<OcctFactory> => {
  const existing = nativeScriptPromises.get(moduleUrl);
  if (existing) return existing;

  const promise = new Promise<OcctFactory>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = moduleUrl;
    script.async = true;
    script.dataset.occtNativeWrapper = moduleUrl;
    script.onload = () => {
      const factory = (window as any).occtimportjs || (window as any).occtImportJs;
      if (typeof factory === "function") {
        resolve(factory);
      } else {
        reject(new Error(`Native OCCT wrapper did not expose a factory: ${moduleUrl}`));
      }
    };
    script.onerror = () => reject(new Error(`Failed to load native OCCT wrapper: ${moduleUrl}`));
    document.head.appendChild(script);
  });

  nativeScriptPromises.set(moduleUrl, promise);
  promise.catch(() => nativeScriptPromises.delete(moduleUrl));
  return promise;
};

const loadNativeFactory = async (moduleUrl: string): Promise<OcctFactory> => {
  if (typeof document !== "undefined") {
    return loadNativeBrowserFactory(moduleUrl);
  }

  const imported = await import(/* @vite-ignore */ moduleUrl);
  const factory = imported.default || imported;
  if (typeof factory !== "function") {
    throw new Error(`Native OCCT wrapper does not export a factory: ${moduleUrl}`);
  }
  return factory;
};

const loadNativeOcct = (moduleUrl: string) => {
  const existing = nativeOcctPromises.get(moduleUrl);
  if (existing) return existing;

  const promise = loadNativeFactory(moduleUrl).then((factory) =>
    factory({
      locateFile: (name: string) => getSiblingAssetUrl(moduleUrl, name),
    })
  );
  nativeOcctPromises.set(moduleUrl, promise);
  promise.catch(() => nativeOcctPromises.delete(moduleUrl));
  return promise;
};

const loadStandardOcct = () => {
  if (standardOcctPromise) return standardOcctPromise;

  standardOcctPromise = (async () => {
    try {
      const occtModule = await import("occt-import-js");
      const initFunc = occtModule.default || occtModule;
      return await initFunc({
        locateFile: (name: string) => `${STANDARD_WASM_BASE_URL}${name}`,
      });
    } catch (err) {
      console.warn(
        "Failed to load occt-import-js via ES module, attempting window global fallback",
        err
      );
      const globalInit = typeof window !== "undefined"
        ? (window as any).occtimportjs || (window as any).occtImportJs
        : undefined;
      if (!globalInit) {
        throw new Error(
          "Open Cascade WebAssembly failed to initialize. Ensure network connectivity to the CDN."
        );
      }
      return globalInit({
        locateFile: (name: string) => `${STANDARD_WASM_BASE_URL}${name}`,
      });
    }
  })();

  standardOcctPromise.catch(() => {
    standardOcctPromise = null;
  });
  return standardOcctPromise;
};

export async function loadOcct(options: OcctLoadOptions = {}) {
  const resolved = resolveOcctLoadOptions(options);
  if (resolved.topologyMode === "native") {
    try {
      return await loadNativeOcct(resolved.nativeWrapperUrl);
    } catch (error) {
      console.warn(
        "Native OCCT topology wrapper unavailable; using the standard tessellation wrapper.",
        error
      );
    }
  }

  return loadStandardOcct();
}
