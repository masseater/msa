import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

import { joinPath } from "@msa/testing";
import { colorToHex, okhslColor } from "@msa/tui";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { deleteEnv, readEnv, writeEnv } from "../src/core/process-env.ts";
import { getThemeExportColors } from "../src/modes/interactive/theme/theme.ts";

type ThemeFile = {
  name: string;
  vars?: Record<string, string | number>;
  colors: Record<string, string | number>;
  export?: {
    pageBg?: string | number;
    cardBg?: string | number;
    infoBg?: string | number;
  };
};

describe("getThemeExportColors", () => {
  let tempRoot: string;
  let previousAgentDir: string | undefined;

  beforeEach(() => {
    tempRoot = mkdtempSync(joinPath(tmpdir(), "msa-theme-export-"));
    writeEnv("MSA_CODING_AGENT_DIR", joinPath(tempRoot, "agent"));
    mkdirSync(joinPath(readEnv("MSA_CODING_AGENT_DIR")!, "themes"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
    if (previousAgentDir === undefined) {
      deleteEnv("MSA_CODING_AGENT_DIR");
    } else {
      writeEnv("MSA_CODING_AGENT_DIR", previousAgentDir);
    }
  });

  it("resolves export variable references using the same syntax as colors", () => {
    const darkTheme = JSON.parse(
      readFileSync(new URL("../src/modes/interactive/theme/dark.json", import.meta.url), "utf-8"),
    ) as ThemeFile;

    const customTheme: ThemeFile = {
      ...darkTheme,
      name: "custom-export-vars",
      vars: {
        ...(darkTheme.vars ?? {}),
        pageBgVar: "#112233",
        pageBgAlias: "pageBgVar",
        infoBgVar: "#445566",
        cardBgVar: "#223344",
      },
      export: {
        pageBg: "pageBgAlias",
        cardBg: "cardBgVar",
        infoBg: "infoBgVar",
      },
    };

    writeFileSync(
      joinPath(readEnv("MSA_CODING_AGENT_DIR")!, "themes", "custom-export-vars.json"),
      JSON.stringify(customTheme, null, 2),
    );

    expect(getThemeExportColors("custom-export-vars")).toEqual({
      pageBg: "#112233",
      cardBg: "#223344",
      infoBg: "#445566",
    });
  });

  it("converts OKHSL export colors to hex because CSS does not support them", () => {
    const darkTheme = JSON.parse(
      readFileSync(new URL("../src/modes/interactive/theme/dark.json", import.meta.url), "utf-8"),
    ) as ThemeFile;
    const customTheme: ThemeFile = {
      ...darkTheme,
      name: "custom-export-okhsl",
      vars: { card: "okhsl(250 20% 20%)" },
      export: { pageBg: "okhsl(250 20% 15%)", cardBg: "card", infoBg: "oklch(30% 0.05 80)" },
    };
    writeFileSync(
      joinPath(readEnv("MSA_CODING_AGENT_DIR")!, "themes", "custom-export-okhsl.json"),
      JSON.stringify(customTheme, null, 2),
    );

    expect(getThemeExportColors("custom-export-okhsl")).toEqual({
      pageBg: colorToHex(okhslColor(250, 0.2, 0.15)),
      cardBg: colorToHex(okhslColor(250, 0.2, 0.2)),
      infoBg: "oklch(30% 0.05 80)",
    });
  });

  it("resolves recursive vars and converts 256-color export values to hex", () => {
    const darkTheme = JSON.parse(
      readFileSync(new URL("../src/modes/interactive/theme/dark.json", import.meta.url), "utf-8"),
    ) as ThemeFile;

    const customTheme: ThemeFile = {
      ...darkTheme,
      name: "custom-export-recursive",
      vars: {
        ...(darkTheme.vars ?? {}),
        deepPageBg: "#abcdef",
        pageBgAlias: "deepPageBg",
        cardBgAnsi: 24,
      },
      export: {
        pageBg: "pageBgAlias",
        cardBg: "cardBgAnsi",
        infoBg: "",
      },
    };

    writeFileSync(
      joinPath(readEnv("MSA_CODING_AGENT_DIR")!, "themes", "custom-export-recursive.json"),
      JSON.stringify(customTheme, null, 2),
    );

    expect(getThemeExportColors("custom-export-recursive")).toEqual({
      pageBg: "#abcdef",
      cardBg: "#005f87",
      infoBg: undefined,
    });
  });
});
