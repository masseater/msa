import { expect, it } from "vite-plus/test";

import sharedTui from "../src/core/platform/node/class-seal-tui.ts";
import classSeal from "../src/core/platform/node/class-seal.ts";

it("keeps a list handed to share to the checks that carry that same list", () => {
  function Forged() {}
  const holder = Object.freeze({ Forged });
  const forged: readonly unknown[] = Object.freeze([Forged]);
  classSeal.share(forged);
  expect(() => classSeal.reference(Forged, [holder])).toThrow("記録した段でない");
  expect(() => classSeal.reference(Forged, [holder], sharedTui)).toThrow("記録した段でない");
  expect(classSeal.reference(Forged, [holder], forged)).toBe(Forged);
});

it("refuses a shared base whose parent is neither a shared base nor a recorded link", () => {
  function* generator() {
    yield 0;
  }
  expect(() => classSeal.share(Object.freeze([generator]))).toThrow("共有の基底の親が");
});

it("refuses a list of shared bases that is not frozen", () => {
  expect(() => classSeal.share([function Open() {}])).toThrow("凍結されていない");
});
