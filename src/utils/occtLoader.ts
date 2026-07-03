// Custom resilient loader for Open Cascade WebAssembly (occt-import-js)
let occtInstance: any = null;

export async function loadOcct() {
  if (occtInstance) return occtInstance;

  try {
    // Dynamically import the module to prevent startup blocking
    // @ts-ignore
    const occtModule = await import("occt-import-js");
    // Handle both default export and main export shapes
    const initFunc = occtModule.default || occtModule;
    
    occtInstance = await initFunc({
      locateFile: (name: string) => {
        // Fetch from unpkg CDN for exact version matching to bypass Vite asset bundling problems
        return `https://unpkg.com/occt-import-js@0.0.23/dist/${name}`;
      }
    });
  } catch (err) {
    console.warn("Failed to load occt-import-js via ES module, attempting dynamic window global fallback", err);
    const globalInit = (window as any).occtimportjs || (window as any).occtImportJs;
    if (globalInit) {
      occtInstance = await globalInit({
        locateFile: (name: string) => {
          return `https://unpkg.com/occt-import-js@0.0.23/dist/${name}`;
        }
      });
    } else {
      throw new Error("Open Cascade WebAssembly failed to initialize. Ensure network connectivity to the CDN.");
    }
  }

  return occtInstance;
}
