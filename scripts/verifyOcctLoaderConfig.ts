import assert from "node:assert/strict";
import {
  getConfiguredOcctLoadOptions,
  resolveOcctLoadOptions,
} from "../src/utils/occtLoader";

const configured = getConfiguredOcctLoadOptions();
assert.equal(configured.topologyMode, "native");
assert.equal(configured.nativeWrapperUrl, "/occt-native/occt-import-js.js");

assert.deepEqual(
  resolveOcctLoadOptions({ topologyMode: "tessellation" }),
  {
    topologyMode: "tessellation",
    nativeWrapperUrl: "/occt-native/occt-import-js.js",
  }
);

assert.deepEqual(
  resolveOcctLoadOptions({
    topologyMode: "native",
    nativeWrapperUrl: " /custom/occt.js ",
  }),
  {
    topologyMode: "native",
    nativeWrapperUrl: "/custom/occt.js",
  }
);

console.log("OCCT loader defaults to native and preserves the fallback override.");
