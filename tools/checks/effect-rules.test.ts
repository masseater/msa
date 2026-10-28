import { presets } from "@effect/tsgo/oxlint-presets";
import { expect, it } from "vite-plus/test";

import lintConfig from "../../lint.config.ts";

const { adoptedEffectRules, declinedEffectRules } = lintConfig;

const presetRules = new Set(
  Object.values(presets).flatMap((preset) => Object.keys(preset.rules ?? {})),
);

const decided = [...adoptedEffectRules, ...declinedEffectRules];
const decidedSet = new Set(decided);

it("decides whether to adopt every rule in the effect-tsgo presets", () => {
  expect([...presetRules].filter((name) => !decidedSet.has(name))).toEqual([]);
});

it("lists only rules that the effect-tsgo presets ship", () => {
  expect(decided.filter((name) => !presetRules.has(name))).toEqual([]);
});

it("puts each rule in one list only", () => {
  expect(decided.filter((name, index) => decided.indexOf(name) !== index)).toEqual([]);
});
