import config from "../../../config.ts";
import nodeFs from "../../../core/platform/node/fs.ts";
import textModule from "../../../utils/text.ts";
import pathModule from "../../path.ts";
import type themeSchemaTypes from "./theme-schema.types.ts";
import themeState from "./theme-state.ts";
import type themeTypes from "./theme.types.ts";

const { getCustomThemesDir, getThemesDir } = config;
const { join } = pathModule;
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

let builtinThemes: Record<string, themeSchemaTypes.ValidatedThemeJson> | undefined;

function readBuiltinTheme(themesDir: string, name: string): themeSchemaTypes.ValidatedThemeJson {
  const content = nodeFs.readFileSync(join(themesDir, `${name}.json`), "utf-8");
  return JSON.parse(stripBom(content)) as themeSchemaTypes.ValidatedThemeJson;
}

function getBuiltinThemes(): Record<string, themeSchemaTypes.ValidatedThemeJson> {
  if (builtinThemes === undefined) {
    const themesDir = getThemesDir();
    builtinThemes = {
      dark: readBuiltinTheme(themesDir, "dark"),
      light: readBuiltinTheme(themesDir, "light"),
    };
  }
  return builtinThemes;
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

function readThemeFile(themePath: string, label = themePath): themeSchemaTypes.ValidatedThemeJson {
  return parseThemeJsonContent(label, nodeFs.readFileSync(themePath, "utf-8"));
}

function loadThemeJson(name: string): themeSchemaTypes.ValidatedThemeJson {
  const builtinTheme = getBuiltinThemes()[name];
  if (builtinTheme !== undefined) {
    return builtinTheme;
  }
  const registeredTheme = registeredThemes.get(name);
  if (registeredTheme?.sourcePath !== undefined && registeredTheme?.sourcePath !== "") {
    return readThemeFile(registeredTheme.sourcePath);
  }
  if (registeredTheme !== undefined) {
    throw new Error(`Theme "${name}" does not have a source path for export`);
  }
  const themePath = join(getCustomThemesDir(), `${name}.json`);
  if (!nodeFs.existsSync(themePath)) {
    throw new Error(`Theme not found: ${name}`);
  }
  return readThemeFile(themePath, name);
}

const themeJson = {
  getBuiltinThemes,
  loadThemeJson,
  readThemeFile,
  resolveThemeColors,
  resolveVarRefs,
  setThemeJsonValidator,
};

export default themeJson;
