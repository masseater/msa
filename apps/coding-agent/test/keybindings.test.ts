import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { KEYBINDINGS, useWindowsKeybindings } from "../src/core/keybindings.ts";

const { readTextFile, resolvePath, runTest } = testing;

const usesWindowsKeybindingsOnNativeWindows = () => {
  expect(useWindowsKeybindings("win32", {})).toBe(true);
};

const usesWindowsKeybindingsInWslWithoutRelying = () => {
  expect(useWindowsKeybindings("linux", { WSL_DISTRO_NAME: "Ubuntu" })).toBe(true);
  expect(useWindowsKeybindings("linux", { WSL_INTEROP: "/run/WSL/123_interop" })).toBe(true);
};

const doesNotUseWindowsKeybindingsFromWt = () => {
  expect(useWindowsKeybindings("linux", { WT_SESSION: "session" })).toBe(false);
};

const keepsNonWindowsDefaultsOnOtherPlatforms = () => {
  expect(useWindowsKeybindings("linux", {})).toBe(false);
  expect(useWindowsKeybindings("darwin", {})).toBe(false);
};

const appliesTheDetectedDefaultsConsistently = () => {
  const windowsKeybindings = useWindowsKeybindings();
  const nativeWindows = process.platform === "win32";

  expect(KEYBINDINGS["app.clipboard.pasteImage"].defaultKeys).toEqual(
    windowsKeybindings ? "alt+v" : ["ctrl+v", "alt+v"],
  );
  expect(KEYBINDINGS["tui.altScreen.search"].defaultKeys).toBe(
    windowsKeybindings ? "ctrl+f" : "ctrl+shift+f",
  );
  expect(KEYBINDINGS["app.message.followUp"].defaultKeys).toBe(
    windowsKeybindings ? "ctrl+q" : "alt+enter",
  );
  expect(KEYBINDINGS["app.model.cycleBackward"].defaultKeys).toBe(
    windowsKeybindings ? "alt+p" : "shift+ctrl+p",
  );
  expect(KEYBINDINGS["tui.editor.undo"].defaultKeys).toBe(
    nativeWindows ? "ctrl+z" : windowsKeybindings ? "alt+z" : "ctrl+-",
  );
  expect(KEYBINDINGS["tui.altScreen.previousPrompt"].defaultKeys).toEqual(
    windowsKeybindings ? "ctrl+up" : ["ctrl+shift+up", "ctrl+up"],
  );
  expect(KEYBINDINGS["tui.altScreen.nextPrompt"].defaultKeys).toEqual(
    windowsKeybindings ? "ctrl+down" : ["ctrl+shift+down", "ctrl+down"],
  );
  expect(KEYBINDINGS["app.message.dequeue"].defaultKeys).toBe(
    windowsKeybindings ? "alt+q" : "alt+up",
  );
};

describe("Windows keybinding defaults", () => {
  it("uses Windows keybindings on native Windows", usesWindowsKeybindingsOnNativeWindows);

  it(
    "uses Windows keybindings in WSL without relying on Windows Terminal detection",
    usesWindowsKeybindingsInWslWithoutRelying,
  );

  it("does not use Windows keybindings from WT_SESSION alone", doesNotUseWindowsKeybindingsFromWt);

  it("keeps non-Windows defaults on other platforms", keepsNonWindowsDefaultsOnOtherPlatforms);

  it("applies the detected defaults consistently", appliesTheDetectedDefaultsConsistently);
});

const listsEveryKeybindingIdInDocsKeybindings = () =>
  runTest(
    Effect.gen(function* () {
      const documentation = yield* readTextFile(
        resolvePath(import.meta.dirname, "../docs/keybindings.md"),
      );
      const missing = Object.keys(KEYBINDINGS).filter((id) => !documentation.includes(`\`${id}\``));
      expect(missing).toEqual([]);
    }),
  );

describe("documented keybindings", () => {
  it("lists every keybinding id in docs/keybindings.md", listsEveryKeybindingIdInDocsKeybindings);
});
