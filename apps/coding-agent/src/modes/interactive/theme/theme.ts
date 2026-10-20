import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { dual } from "effect/Function";

import config from "../../../config.ts";
import platform from "../../../core/platform.ts";
import type platformTypes from "../../../core/platform.types.ts";
import nodeFs from "../../../core/platform/node/fs.ts";
import type nodeFsTypes from "../../../core/platform/node/fs.types.ts";
import errors from "../../../utils/errors.ts";
import fsWatch from "../../../utils/fs-watch.ts";
import syntaxHighlight from "../../../utils/syntax-highlight.ts";
import textModule from "../../../utils/text.ts";
import pathModule from "../../path.ts";
import systemTheme from "./system-theme.ts";
import terminalColorsModule from "./terminal-colors.ts";
import Theme from "./theme-class.ts";
import themeColorTokens from "./theme-color-tokens.ts";
import type themeSchemaTypes from "./theme-schema.types.ts";
import type themeTypes from "./theme.types.ts";

const { getTerminalColors, getTerminalTheme, terminalColorsArePending } = terminalColorsModule;
const { splitThemeColors, withThemeTokenFallbacks } = themeColorTokens;
const { SYSTEM_THEME_NAME, generateSystemThemeColors } = systemTheme;
const { getCustomThemesDir, getThemesDir } = config;
const { join } = pathModule;
const { stripBom } = textModule;
const { schedule } = platform;
const { toErrorMessage } = errors;
const { closeWatcher, watchWithErrorHandler } = fsWatch;
const { highlight, supportsLanguage } = syntaxHighlight;

const { colorToHex, getTerminalColorMode, indexedColor, parseColor } = tui;

let themeJsonValidator: themeTypes.ThemeJsonValidator | undefined;

function setThemeJsonValidator(validator: themeTypes.ThemeJsonValidator): void {
  themeJsonValidator = validator;
}

function resolveVarRefs(
  value: themeSchemaTypes.ThemeColorValue,
  vars: Record<string, themeSchemaTypes.ThemeColorValue>,
  visited = new Set<string>(),
): string | number {
  if (
    typeof value === "number" ||
    value === "" ||
    value.startsWith("#") ||
    /^ok(lch|hsl)\(/iu.test(value)
  ) {
    return value;
  }
  if (visited.has(value)) {
    throw new Error(`Circular variable reference detected: ${value}`);
  }
  const reference = vars[value];
  if (reference === undefined) {
    throw new Error(`Variable reference not found: ${value}`);
  }
  visited.add(value);
  return resolveVarRefs(reference, vars, visited);
}

function resolveThemeColors<T extends Record<string, themeSchemaTypes.ThemeColorValue>>(
  colors: T,
  vars: Record<string, themeSchemaTypes.ThemeColorValue> = {},
): Record<keyof T, string | number> {
  const resolved: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(colors)) {
    resolved[key] = resolveVarRefs(value, vars);
  }
  return resolved as Record<keyof T, string | number>;
}

let BUILTIN_THEMES: Record<string, themeSchemaTypes.ValidatedThemeJson> | undefined;

function getBuiltinThemes(): Record<string, themeSchemaTypes.ValidatedThemeJson> {
  if (BUILTIN_THEMES === undefined) {
    const themesDir = getThemesDir();
    const darkPath = join(themesDir, "dark.json");
    const lightPath = join(themesDir, "light.json");
    BUILTIN_THEMES = {
      dark: JSON.parse(
        stripBom(nodeFs.readFileSync(darkPath, "utf-8")),
      ) as themeSchemaTypes.ValidatedThemeJson,
      light: JSON.parse(
        stripBom(nodeFs.readFileSync(lightPath, "utf-8")),
      ) as themeSchemaTypes.ValidatedThemeJson,
    };
  }
  return BUILTIN_THEMES;
}

function getAvailableThemes(): string[] {
  return getAvailableThemesWithPaths().map(({ name }) => name);
}

function getAvailableThemesWithPaths(): themeTypes.ThemeInfo[] {
  const themesDir = getThemesDir();
  const result: themeTypes.ThemeInfo[] = [];
  const seen = new Set<string>();
  const addTheme = (themeInfo: themeTypes.ThemeInfo) => {
    if (seen.has(themeInfo.name)) {
      return;
    }
    seen.add(themeInfo.name);
    result.push(themeInfo);
  };

  addTheme({ name: SYSTEM_THEME_NAME, path: undefined });
  for (const name of Object.keys(getBuiltinThemes())) {
    addTheme({ name, path: join(themesDir, `${name}.json`) });
  }

  for (const themeInfo of getCustomThemeInfos()) {
    addTheme(themeInfo);
  }

  for (const [name, theme] of registeredThemes.entries()) {
    addTheme({ name, path: theme.sourcePath });
  }

  return result.sort((a, b) =>
    a.name === SYSTEM_THEME_NAME
      ? -1
      : b.name === SYSTEM_THEME_NAME
        ? 1
        : a.name.localeCompare(b.name),
  );
}

function getCustomThemeInfos(): themeTypes.ThemeInfo[] {
  const customThemesDir = getCustomThemesDir();
  const result: themeTypes.ThemeInfo[] = [];
  if (!nodeFs.existsSync(customThemesDir)) {
    return result;
  }

  for (const file of nodeFs.readdirSync(customThemesDir)) {
    if (!file.endsWith(".json")) {
      continue;
    }
    const themePath = join(customThemesDir, file);
    try {
      const customTheme = loadThemeFromPath(themePath);
      if (customTheme.name !== undefined && customTheme.name !== "") {
        result.push({ name: customTheme.name, path: themePath });
      }
    } catch {}
  }
  return result;
}

function assertThemeNameIsValid(name: string): void {
  if (name.includes("/")) {
    throw new Error(
      `Invalid theme name "${name}": theme names cannot contain "/" because it is reserved for automatic light/dark theme settings.`,
    );
  }
}

function parseThemeJson(label: string, json: unknown): themeSchemaTypes.ValidatedThemeJson {
  if (themeJsonValidator !== undefined) return themeJsonValidator(label, json);
  if (typeof json !== "object" || json === null || !("colors" in json)) {
    throw new Error(`Invalid theme "${label}": expected an object with a "colors" map.`);
  }
  return json as themeSchemaTypes.ValidatedThemeJson;
}

function parseThemeJsonContent(
  label: string,
  content: string,
): themeSchemaTypes.ValidatedThemeJson {
  let json: unknown;
  try {
    json = JSON.parse(stripBom(content));
  } catch (error) {
    throw new Error(`Failed to parse theme ${label}: ${error}`, { cause: error });
  }
  return parseThemeJson(label, json);
}

function loadThemeJson(name: string): themeSchemaTypes.ValidatedThemeJson {
  const builtinThemes = getBuiltinThemes();
  const builtinTheme = builtinThemes[name];
  if (builtinTheme !== undefined) {
    return builtinTheme;
  }
  const registeredTheme = registeredThemes.get(name);
  if (registeredTheme?.sourcePath !== undefined && registeredTheme?.sourcePath !== "") {
    const content = nodeFs.readFileSync(registeredTheme.sourcePath, "utf-8");
    return parseThemeJsonContent(registeredTheme.sourcePath, content);
  }
  if (registeredTheme !== undefined) {
    throw new Error(`Theme "${name}" does not have a source path for export`);
  }
  const customThemesDir = getCustomThemesDir();
  const themePath = join(customThemesDir, `${name}.json`);
  if (!nodeFs.existsSync(themePath)) {
    throw new Error(`Theme not found: ${name}`);
  }
  const content = nodeFs.readFileSync(themePath, "utf-8");
  return parseThemeJsonContent(name, content);
}

function createTheme(
  themeJson: themeSchemaTypes.ValidatedThemeJson,
  mode?: tuiTypes.TerminalColorMode,
  sourcePath?: string,
): Theme {
  const colorMode = mode ?? getTerminalColorMode();
  const resolvedColors = withThemeTokenFallbacks(
    resolveThemeColors(themeJson.colors, themeJson.vars),
  );
  const { fgColors, bgColors } = splitThemeColors(resolvedColors);
  return new Theme(fgColors, bgColors, colorMode, {
    appearance: themeJson.appearance,
    name: themeJson.name,
    sourcePath,
  });
}

function createSystemTheme(mode?: tuiTypes.TerminalColorMode): Theme {
  const generated = generateSystemThemeColors({
    ...getTerminalColors(),
    appearanceHint: getTerminalTheme(),
    saturation: terminalColorsArePending() ? 0 : 1,
  });
  const { fgColors, bgColors } = splitThemeColors(withThemeTokenFallbacks(generated.colors));
  return new Theme(fgColors, bgColors, mode ?? getTerminalColorMode(), {
    appearance: generated.appearance,
    dim: generated.dim,
    name: SYSTEM_THEME_NAME,
  });
}

const loadThemeFromPath: {
  (mode?: tuiTypes.TerminalColorMode): (themePath: string) => Theme;
  (themePath: string, mode?: tuiTypes.TerminalColorMode): Theme;
} = dual(
  (args) => typeof args[0] === "string" && args[0] !== "truecolor" && args[0] !== "256color",
  (themePath: string, mode?: tuiTypes.TerminalColorMode): Theme => {
    const content = nodeFs.readFileSync(themePath, "utf-8");
    const themeJson = parseThemeJsonContent(themePath, content);
    return createTheme(themeJson, mode, themePath);
  },
);

function loadTheme(name: string, mode?: tuiTypes.TerminalColorMode): Theme {
  if (name === SYSTEM_THEME_NAME) return createSystemTheme(mode);
  const registeredTheme = registeredThemes.get(name);
  if (registeredTheme !== undefined) {
    return registeredTheme;
  }
  const themeJson = loadThemeJson(name);
  return createTheme(themeJson, mode);
}

function getThemeByName(name: string): Theme | undefined {
  try {
    return loadTheme(name);
  } catch {
    return undefined;
  }
}

function parseAutoThemeSetting(
  themeSetting: string | undefined,
): { lightTheme: string; darkTheme: string } | undefined {
  if (themeSetting === undefined || themeSetting === "") return undefined;
  const slashIndex = themeSetting.indexOf("/");
  if (slashIndex === -1 || themeSetting.indexOf("/", slashIndex + 1) !== -1) {
    return undefined;
  }

  const lightTheme = themeSetting.slice(0, slashIndex).trim();
  const darkTheme = themeSetting.slice(slashIndex + 1).trim();
  if (lightTheme === "" || darkTheme === "") {
    return undefined;
  }
  return { darkTheme, lightTheme };
}

const resolveThemeSetting: {
  (
    terminalTheme: themeTypes.TerminalTheme,
  ): (themeSetting: string | undefined) => string | undefined;
  (themeSetting: string | undefined, terminalTheme: themeTypes.TerminalTheme): string | undefined;
} = dual(
  2,
  (
    themeSetting: string | undefined,
    terminalTheme: themeTypes.TerminalTheme,
  ): string | undefined => {
    const autoTheme = parseAutoThemeSetting(themeSetting);
    if (autoTheme !== undefined) {
      return terminalTheme === "light" ? autoTheme.lightTheme : autoTheme.darkTheme;
    }
    if (themeSetting?.includes("/") === true) return undefined;
    if (typeof themeSetting === "string") return themeSetting;
    return undefined;
  },
);

const THEME_KEY = Symbol.for("@msa/coding-agent:theme");
const THEME_KEY_OLD = Symbol.for("@mariozechner/pi-coding-agent:theme");

const theme: Theme = new Proxy({} as Theme, {
  get(_target, prop) {
    const t = (globalThis as Record<symbol, Theme>)[THEME_KEY];
    if (t === undefined) throw new Error("Theme not initialized. Call initTheme() first.");
    return (t as unknown as Record<string | symbol, unknown>)[prop];
  },
});

function setGlobalTheme(t: Theme): void {
  (globalThis as Record<symbol, Theme>)[THEME_KEY] = t;
  (globalThis as Record<symbol, Theme>)[THEME_KEY_OLD] = t;
}

let currentThemeName: string | undefined;
let themeWatcher: nodeFsTypes.FSWatcher | undefined;
let themeReloadTimer: platformTypes.Scheduled | undefined;
let onThemeChangeCallback: (() => void) | undefined;
const registeredThemes = new Map<string, Theme>();

function setRegisteredThemes(themes: Theme[]): void {
  registeredThemes.clear();
  for (const entry of themes) {
    if (entry.name !== undefined && entry.name !== "") {
      assertThemeNameIsValid(entry.name);
      registeredThemes.set(entry.name, entry);
    }
  }
}

const initTheme: {
  (enableWatcher?: boolean): (themeName?: string) => void;
  (themeName?: string, enableWatcher?: boolean): void;
} = dual(
  (args) => typeof args[0] !== "boolean",
  (themeName?: string, enableWatcher: boolean = false): void => {
    const name = themeName ?? SYSTEM_THEME_NAME;
    currentThemeName = name;
    try {
      setGlobalTheme(loadTheme(name));
      if (enableWatcher) {
        startThemeWatcher();
      }
    } catch {
      currentThemeName = SYSTEM_THEME_NAME;
      setGlobalTheme(loadTheme(SYSTEM_THEME_NAME));
    }
  },
);

const setTheme: {
  (enableWatcher?: boolean): (name: string) => { success: boolean; error?: string };
  (name: string, enableWatcher?: boolean): { success: boolean; error?: string };
} = dual(
  (args) => typeof args[0] === "string",
  (name: string, enableWatcher: boolean = false): { success: boolean; error?: string } => {
    currentThemeName = name;
    try {
      setGlobalTheme(loadTheme(name));
      if (enableWatcher) {
        startThemeWatcher();
      }
      if (onThemeChangeCallback !== undefined) {
        onThemeChangeCallback();
      }
      return { success: true };
    } catch (error) {
      currentThemeName = SYSTEM_THEME_NAME;
      setGlobalTheme(loadTheme(SYSTEM_THEME_NAME));
      return {
        error: toErrorMessage(error),
        success: false,
      };
    }
  },
);

function setThemeInstance(themeInstance: Theme): void {
  setGlobalTheme(themeInstance);
  currentThemeName = "<in-memory>";
  stopThemeWatcher();
  if (onThemeChangeCallback !== undefined) {
    onThemeChangeCallback();
  }
}

function onThemeChange(callback: () => void): void {
  onThemeChangeCallback = callback;
}

function startThemeWatcher(): void {
  stopThemeWatcher();

  if (
    currentThemeName === undefined ||
    currentThemeName === "" ||
    currentThemeName === "dark" ||
    currentThemeName === "light" ||
    currentThemeName === SYSTEM_THEME_NAME
  ) {
    return;
  }

  const customThemesDir = getCustomThemesDir();
  const watchedThemeName = currentThemeName;
  const watchedFileName = `${watchedThemeName}.json`;
  const themeFile = join(customThemesDir, watchedFileName);

  if (!nodeFs.existsSync(themeFile)) {
    return;
  }

  const scheduleReload = startThemeWatcherScheduleReload(watchedThemeName, themeFile);

  startThemeWatcherPart2(customThemesDir, watchedThemeName, scheduleReload, watchedFileName);
}

function startThemeWatcherScheduleReload(watchedThemeName: string, themeFile: string): () => void {
  const scheduleReload = () => {
    if (themeReloadTimer !== undefined) {
      themeReloadTimer.cancel();
    }
    themeReloadTimer = schedule(() => {
      themeReloadTimer = undefined;

      if (currentThemeName !== watchedThemeName) {
        return;
      }

      if (!nodeFs.existsSync(themeFile)) {
        return;
      }

      try {
        const reloadedTheme = loadThemeFromPath(themeFile);
        registeredThemes.set(watchedThemeName, reloadedTheme);
        setGlobalTheme(reloadedTheme);
        if (onThemeChangeCallback !== undefined) {
          onThemeChangeCallback();
        }
      } catch {}
    }, 100);
  };
  return scheduleReload;
}

function startThemeWatcherPart2(
  customThemesDir: string,
  watchedThemeName: string,
  scheduleReload: () => void,
  watchedFileName: string,
): void {
  themeWatcher =
    watchWithErrorHandler(
      customThemesDir,
      (_eventType, filename) => {
        if (currentThemeName !== watchedThemeName) {
          return;
        }
        if (filename === null || filename === "") {
          scheduleReload();
          return;
        }
        if (filename !== watchedFileName) {
          return;
        }
        scheduleReload();
      },
      () => {
        closeWatcher(themeWatcher);
        themeWatcher = undefined;
      },
    ) ?? undefined;
}

function stopThemeWatcher(): void {
  if (themeReloadTimer !== undefined) {
    themeReloadTimer.cancel();
    themeReloadTimer = undefined;
  }
  closeWatcher(themeWatcher);
  themeWatcher = undefined;
}

function getResolvedThemeColors(themeName?: string): Record<string, string> {
  const colors = loadTheme(themeName ?? currentThemeName ?? SYSTEM_THEME_NAME).colors;
  return Object.fromEntries(
    Object.entries(colors).map(([token, color]) => [token, colorToHex(color)]),
  );
}

function isLightTheme(themeName?: string): boolean {
  return loadTheme(themeName ?? currentThemeName ?? SYSTEM_THEME_NAME).appearance === "light";
}

function getThemeExportColors(themeName?: string): {
  pageBg?: string | undefined;
  cardBg?: string | undefined;
  infoBg?: string | undefined;
} {
  const name = themeName ?? currentThemeName ?? SYSTEM_THEME_NAME;
  if (name === SYSTEM_THEME_NAME) return {};
  try {
    const themeJson = loadThemeJson(name);
    const exportSection = themeJson.export;
    if (exportSection === undefined) return {};

    const vars = themeJson.vars ?? {};
    const resolve = (value: themeSchemaTypes.ThemeColorValue | undefined): string | undefined => {
      if (value === undefined) return undefined;
      const resolved = resolveVarRefs(value, vars);
      if (typeof resolved === "number") return colorToHex(indexedColor(resolved));
      if (resolved === "") return undefined;
      if (/^okhsl\(/iu.test(resolved)) return colorToHex(parseColor(resolved));
      return resolved;
    };

    return {
      cardBg: resolve(exportSection.cardBg),
      infoBg: resolve(exportSection.infoBg),
      pageBg: resolve(exportSection.pageBg),
    };
  } catch {
    return {};
  }
}

type CliHighlightTheme = Record<string, (s: string) => string>;

let cachedHighlightThemeFor: Theme | undefined;
let cachedCliHighlightTheme: CliHighlightTheme | undefined;

function buildCliHighlightTheme(t: Theme): CliHighlightTheme {
  return {
    addition: (s: string) => t.fg("toolDiffAdded", s),
    attr: (s: string) => t.fg("syntaxVariable", s),
    built_in: (s: string) => t.fg("syntaxType", s),
    class: (s: string) => t.fg("syntaxType", s),
    comment: (s: string) => t.fg("syntaxComment", s),
    deletion: (s: string) => t.fg("toolDiffRemoved", s),
    doctag: (s: string) => t.fg("syntaxComment", s),
    emphasis: (s: string) => t.italic(s),
    function: (s: string) => t.fg("syntaxFunction", s),
    keyword: (s: string) => t.fg("syntaxKeyword", s),
    link: (s: string) => t.underline(s),
    literal: (s: string) => t.fg("syntaxNumber", s),
    meta: (s: string) => t.fg("muted", s),
    name: (s: string) => t.fg("syntaxKeyword", s),
    number: (s: string) => t.fg("syntaxNumber", s),
    operator: (s: string) => t.fg("syntaxOperator", s),
    params: (s: string) => t.fg("syntaxVariable", s),
    punctuation: (s: string) => t.fg("syntaxPunctuation", s),
    regexp: (s: string) => t.fg("syntaxString", s),
    string: (s: string) => t.fg("syntaxString", s),
    strong: (s: string) => t.bold(s),
    subst: (s: string) => t.fg("text", s),
    tag: (s: string) => t.fg("syntaxPunctuation", s),
    title: (s: string) => t.fg("syntaxFunction", s),
    type: (s: string) => t.fg("syntaxType", s),
    variable: (s: string) => t.fg("syntaxVariable", s),
  };
}

function getCliHighlightTheme(t: Theme): CliHighlightTheme {
  if (cachedHighlightThemeFor !== t || cachedCliHighlightTheme === undefined) {
    cachedHighlightThemeFor = t;
    cachedCliHighlightTheme = buildCliHighlightTheme(t);
  }
  return cachedCliHighlightTheme;
}

const highlightCode: {
  (lang: string | undefined): (code: string) => string[];
  (code: string, lang: string | undefined): string[];
} = dual(2, (code: string, lang: string | undefined): string[] => {
  const validLang = lang !== undefined && lang !== "" && supportsLanguage(lang) ? lang : undefined;
  if (validLang === undefined || validLang === "") {
    return code.split("\n").map((line) => theme.fg("mdCodeBlock", line));
  }
  const opts = {
    ignoreIllegals: true,
    language: validLang,
    theme: getCliHighlightTheme(theme),
  };
  try {
    return highlight(code, opts).split("\n");
  } catch {
    return code.split("\n");
  }
});

function getLanguageFromPath(filePath: string): string | undefined {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (ext === undefined || ext === "") return undefined;

  const extToLang: Record<string, string> = {
    bash: "bash",
    c: "c",
    cc: "cpp",
    cjs: "javascript",
    clj: "clojure",
    cmake: "cmake",
    cpp: "cpp",
    cs: "csharp",
    css: "css",
    cxx: "cpp",
    dockerfile: "dockerfile",
    erl: "erlang",
    ex: "elixir",
    exs: "elixir",
    fish: "fish",
    go: "go",
    graphql: "graphql",
    h: "c",
    hcl: "hcl",
    hpp: "cpp",
    hs: "haskell",
    htm: "html",
    html: "html",
    java: "java",
    js: "javascript",
    json: "json",
    jsx: "javascript",
    kt: "kotlin",
    less: "less",
    lua: "lua",
    makefile: "makefile",
    markdown: "markdown",
    md: "markdown",
    mjs: "javascript",
    ml: "ocaml",
    perl: "perl",
    php: "php",
    proto: "protobuf",
    ps1: "powershell",
    py: "python",
    r: "r",
    rb: "ruby",
    rs: "rust",
    sass: "sass",
    scala: "scala",
    scss: "scss",
    sh: "bash",
    sql: "sql",
    swift: "swift",
    tf: "hcl",
    toml: "toml",
    ts: "typescript",
    tsx: "typescript",
    vim: "vim",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    zsh: "bash",
  };

  return extToLang[ext];
}

function getMarkdownTheme(): tuiTypes.MarkdownTheme {
  return {
    bold: (text: string) => theme.bold(text),
    code: (text: string) => theme.fg("mdCode", text),
    codeBlock: (text: string) => theme.fg("mdCodeBlock", text),
    codeBlockBorder: (text: string) => theme.fg("mdCodeBlockBorder", text),
    heading: (text: string) => theme.fg("mdHeading", text),
    highlightCode: (code: string, lang?: string): string[] => {
      const validLang =
        lang !== undefined && lang !== "" && supportsLanguage(lang) ? lang : undefined;
      if (validLang === undefined || validLang === "") {
        return code.split("\n").map((line) => theme.fg("mdCodeBlock", line));
      }
      const opts = {
        ignoreIllegals: true,
        language: validLang,
        theme: getCliHighlightTheme(theme),
      };
      try {
        return highlight(code, opts).split("\n");
      } catch {
        return code.split("\n").map((line) => theme.fg("mdCodeBlock", line));
      }
    },
    hr: (text: string) => theme.fg("mdHr", text),
    italic: (text: string) => theme.italic(text),
    link: (text: string) => theme.fg("mdLink", text),
    linkUrl: (text: string) => theme.fg("mdLinkUrl", text),
    listBullet: (text: string) => theme.fg("mdListBullet", text),
    quote: (text: string) => theme.fg("mdQuote", text),
    quoteBorder: (text: string) => theme.fg("mdQuoteBorder", text),
    strikethrough: (text: string) => theme.strikethrough(text),
    underline: (text: string) => theme.underline(text),
  };
}

function getSelectListTheme(): tuiTypes.SelectListTheme {
  return {
    description: (text: string) => theme.fg("muted", text),
    noMatch: (text: string) => theme.fg("muted", text),
    scrollInfo: (text: string) => theme.fg("muted", text),
    selectedPrefix: (text: string) => theme.fg("accent", text),
    selectedText: (text: string) => theme.fg("accent", text),
  };
}

function getEditorTheme(): tuiTypes.EditorTheme {
  return {
    borderColor: (text: string) => theme.fg("borderMuted", text),
    selectList: getSelectListTheme(),
  };
}

function getSettingsListTheme(): tuiTypes.SettingsListTheme {
  return {
    cursor: theme.fg("accent", "→ "),
    description: (text: string) => theme.fg("dim", text),
    hint: (text: string) => theme.fg("dim", text),
    label: (text: string, selected: boolean) => (selected ? theme.fg("accent", text) : text),
    value: (text: string, selected: boolean) =>
      selected ? theme.fg("accent", text) : theme.fg("muted", text),
  };
}

const themeModule = {
  SYSTEM_THEME_NAME: systemTheme.SYSTEM_THEME_NAME,
  getAvailableThemes,
  getAvailableThemesWithPaths,
  getEditorTheme,
  getLanguageFromPath,
  getMarkdownTheme,
  getResolvedThemeColors,
  getSelectListTheme,
  getSettingsListTheme,
  getThemeByName,
  getThemeExportColors,
  highlightCode,
  initTheme,
  isLightTheme,
  loadThemeFromPath,
  onThemeChange,
  parseAutoThemeSetting,
  resolveThemeSetting,
  setRegisteredThemes,
  setTheme,
  setThemeInstance,
  setThemeJsonValidator,
  stopThemeWatcher,
  theme,
};

export default themeModule;
