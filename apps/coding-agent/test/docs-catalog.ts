import { type Token, type Tokens, lexer, walkTokens } from "marked";

type NavigationItem =
  | { title: string; path: string; items?: NavigationItem[] }
  | { title: string; items: NavigationItem[] };

interface NavigationGroup {
  title: string;
  items: NavigationItem[];
}

function requireObject(value: unknown, location: string): Record<string, unknown> {
  if (
    !(value !== null && value !== undefined) ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(`${location} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireNonemptyString(value: unknown, location: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${location} must be a nonempty string`);
  }
  return value;
}

function requireFields(value: Record<string, unknown>, fields: string[], location: string): void {
  const unsupportedFields = Object.keys(value)
    .filter((field) => !fields.includes(field))
    .sort();
  if (unsupportedFields.length > 0) {
    throw new Error(`${location} has unsupported fields: ${unsupportedFields.join(", ")}`);
  }
}

function requireDocumentationPath(value: unknown, location: string): string {
  const path = requireNonemptyString(value, location);
  const segments = path.split("/");
  const normalized = segments.every((segment) => segment !== "" && segment !== ".");
  const escapesDocsRoot = segments.includes("..");
  const hasUrlSyntax = path.includes("?") || path.includes("#");
  const hasWindowsSyntax = path.includes("\\") || /^[a-z]:/iu.test(path);

  if (
    path !== path.trim() ||
    !normalized ||
    path.startsWith("/") ||
    escapesDocsRoot ||
    hasUrlSyntax ||
    hasWindowsSyntax ||
    !path.endsWith(".md")
  ) {
    throw new Error(`${location} must be a relative normalized .md path`);
  }
  return path;
}

function readNavigationItem(rawItem: unknown, location: string): NavigationItem {
  const item = requireObject(rawItem, location);
  requireFields(item, ["title", "path", "items"], location);
  const title = requireNonemptyString(item["title"], `${location}.title`);
  const path =
    item["path"] === undefined
      ? undefined
      : requireDocumentationPath(item["path"], `${location}.path`);

  let items: NavigationItem[] | undefined;
  if (item["items"] !== undefined) {
    if (!Array.isArray(item["items"])) throw new Error(`${location}.items must be an array`);
    if (item["items"].length === 0)
      throw new Error(`${location}.items must contain at least one item`);
    items = item["items"].map((child, index) =>
      readNavigationItem(child, `${location}.items[${index}]`),
    );
  }

  if (path !== undefined)
    return items !== undefined && items.length > 0 ? { items, path, title } : { path, title };
  if (items !== undefined) return { items, title };
  throw new Error(`${location} must have a path or items`);
}

function readNavigation(rawCatalog: unknown): NavigationGroup[] {
  const catalog = requireObject(rawCatalog, "Documentation catalog");
  requireFields(catalog, ["navigation", "redirects"], "Documentation catalog");
  if (!Array.isArray(catalog["navigation"]))
    throw new Error("Documentation catalog navigation must be an array");

  return catalog["navigation"].map((rawGroup, groupIndex) => {
    const location = `Documentation catalog navigation[${groupIndex}]`;
    const group = requireObject(rawGroup, location);
    requireFields(group, ["title", "items"], location);
    const title = requireNonemptyString(group["title"], `${location}.title`);
    if (!Array.isArray(group["items"])) throw new Error(`${location}.items must be an array`);
    if (group["items"].length === 0)
      throw new Error(`${location}.items must contain at least one item`);
    return {
      items: group["items"].map((item, itemIndex) =>
        readNavigationItem(item, `${location}.items[${itemIndex}]`),
      ),
      title,
    };
  });
}

function navigationPaths(groups: NavigationGroup[]): string[] {
  const paths: string[] = [];
  const visit = (items: NavigationItem[]): void => {
    for (const item of items) {
      if ("path" in item) paths.push(item.path);
      if (item.items !== undefined && item.items.length > 0) visit(item.items);
    }
  };
  for (const group of groups) visit(group.items);
  return paths;
}

function markdownLinks(markdown: string): string[] {
  const links: string[] = [];
  walkTokens(lexer(markdown), (token: Token) => {
    if (token.type === "link") links.push((token as Tokens.Link).href);
  });
  return links;
}

function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/[^\p{Letter}\p{Number}\s_-]/gu, "")
    .trim()
    .replaceAll(/\s+/gu, "-");
}

function markdownAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  walkTokens(lexer(markdown), (token: Token) => {
    if (token.type === "heading") anchors.add(headingSlug((token as Tokens.Heading).text));
  });
  for (const match of markdown.matchAll(/<a\s+id="([^"]+)"/gu)) {
    const id = match[1];
    if (id !== undefined) anchors.add(id);
  }
  return anchors;
}

function fragmentOf(href: string): string {
  const hash = href.indexOf("#");
  return hash === -1 ? "" : decodeURIComponent(href.slice(hash + 1));
}

function publicSlug(path: string): string {
  const withoutExtension = path.slice(0, -3);
  if (withoutExtension === "index") return "";
  return withoutExtension.endsWith("/index") ? withoutExtension.slice(0, -6) : withoutExtension;
}

const docsCatalog = {
  fragmentOf,
  markdownAnchors,
  markdownLinks,
  navigationPaths,
  publicSlug,
  readNavigation,
};

export default docsCatalog;
