import config from "../../../config.ts";
import directoryEntry from "../../../core/directory-entry.ts";
import platformModule from "../../../core/platform/index.ts";
import textModule from "../../../utils/text.ts";
import darkTheme from "./dark.json" with { type: "json" };
import lightTheme from "./light.json" with { type: "json" };
import type themeSchemaTypes from "./theme-schema.types.ts";
import themeState from "./theme-state.ts";
import type themeTypes from "./theme.types.ts";

const { getCustomThemesDir } = config;
const { join } = platformModule;
const { exists, readText } = platformModule.files;
const { readEntries } = directoryEntry;
const { stripBom } = textModule;
const { registeredThemes } = themeState;

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
  const reference = new Map(Object.entries(vars)).get(value);
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
  return Object.fromEntries(
    Object.entries(colors).map(([key, value]) => [key, resolveVarRefs(value, vars)]),
  ) as Record<keyof T, string | number>;
}

const builtinThemes: Readonly<Record<string, themeSchemaTypes.ValidatedThemeJson>> = {
  dark: darkTheme as themeSchemaTypes.ValidatedThemeJson,
  light: lightTheme as themeSchemaTypes.ValidatedThemeJson,
};

function getBuiltinThemes(): Readonly<Record<string, themeSchemaTypes.ValidatedThemeJson>> {
  return builtinThemes;
}

type CustomThemeFile = {
  readonly path: string;
  readonly json: themeSchemaTypes.ValidatedThemeJson;
};

let customThemeFiles: ReadonlyMap<string, CustomThemeFile> = new Map();

function getCustomThemeFiles(): ReadonlyMap<string, CustomThemeFile> {
  return customThemeFiles;
}

function readCustomThemes(dir: string): Promise<Map<string, CustomThemeFile>> {
  return readEntries(dir)
    .then((entries) =>
      Promise.all(
        entries
          .filter((entry) => entry.name.endsWith(".json"))
          .map((entry) => {
            const name = entry.name.slice(0, -".json".length);
            const path = join(dir, entry.name);
            return readThemeFile(path, name).then(
              (json) => [name, { json, path }] as const,
              () => undefined,
            );
          }),
      ),
    )
    .then(
      (loaded) =>
        new Map(loaded.filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)),
    );
}

function refreshCustomThemes(): Promise<void> {
  const dir = getCustomThemesDir();
  return exists(dir)
    .then((found) => (found ? readCustomThemes(dir) : new Map<string, CustomThemeFile>()))
    .then((loaded) => {
      customThemeFiles = loaded;
      return undefined;
    });
}

function setCustomThemeFile(name: string, file: CustomThemeFile): void {
  customThemeFiles = new Map([...customThemeFiles, [name, file]]);
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

function readThemeFile(
  themePath: string,
  label = themePath,
): Promise<themeSchemaTypes.ValidatedThemeJson> {
  return readText(themePath).then((content) => parseThemeJsonContent(label, content));
}

function loadThemeJson(name: string): themeSchemaTypes.ValidatedThemeJson {
  const builtinTheme = new Map(Object.entries(getBuiltinThemes())).get(name);
  if (builtinTheme !== undefined) {
    return builtinTheme;
  }
  const registeredTheme = registeredThemes.get(name);
  if (registeredTheme?.sourceJson !== undefined) {
    return registeredTheme.sourceJson;
  }
  if (registeredTheme !== undefined) {
    throw new Error(`Theme "${name}" does not have a source path for export`);
  }
  const customTheme = customThemeFiles.get(name);
  if (customTheme === undefined) {
    throw new Error(`Theme not found: ${name}`);
  }
  return customTheme.json;
}

const themeJson = {
  getBuiltinThemes,
  getCustomThemeFiles,
  loadThemeJson,
  readThemeFile,
  refreshCustomThemes,
  resolveThemeColors,
  resolveVarRefs,
  setCustomThemeFile,
  setThemeJsonValidator,
};

export default themeJson;
