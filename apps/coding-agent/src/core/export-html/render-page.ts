import htmlModule from "../../utils/html.ts";
import platform from "../platform/index.ts";
import exportColors from "./export-colors.ts";
import type exportTypesTypes from "./export-types.ts";
import renderEntryModule from "./render-entry.ts";
import renderHeaderModule from "./render-header.ts";
import renderTreeModule from "./render-tree.ts";
import sessionGraphModule from "./session-graph.ts";
import viewCssModule from "./view-css.ts";

const { formatLocalTime } = platform;
const { themeCss } = exportColors;
const { escapeXml } = htmlModule;
const { renderEntries } = renderEntryModule;
const { renderHeader } = renderHeaderModule;
const { FILTER_MODES, renderTrees } = renderTreeModule;
const { entryRefs, sessionGraph } = sessionGraphModule;
const { viewCss } = viewCssModule;

const CONTENT_SECURITY_POLICY =
  "default-src 'none'; img-src data: http: https:; style-src 'unsafe-inline'; form-action 'none'";

const SRCDOC_BASE = '<base href="about:srcdoc">';

const FILTER_TITLES: Readonly<Record<string, readonly [label: string, title: string]>> = {
  all: ["All", "Show everything"],
  default: ["Default", "Hide settings entries"],
  "labeled-only": ["Labeled", "Only labeled entries"],
  "no-tools": ["No-tools", "Default minus tool results"],
  "user-only": ["User", "Only user messages"],
};

const HAMBURGER =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><rect x="5" y="6" width="2" height="12"/><path d="M6 12h10c1 0 2 0 2-2V8"/></svg>';

const formatIfSet = (timestamp: string | undefined, layout: string): string | undefined =>
  timestamp === undefined || timestamp === "" ? undefined : formatLocalTime(timestamp, layout);

const timesOf = (sessionData: exportTypesTypes.SessionData): ReadonlyMap<string, string> =>
  new Map(
    sessionData.entries.flatMap(({ id, timestamp }) => {
      const time = formatIfSet(timestamp, "HH:mm:ss");
      return time === undefined ? [] : [[id, time] as const];
    }),
  );

const jsonlOf = (sessionData: exportTypesTypes.SessionData): string => {
  const header = sessionData.header === null ? [] : [sessionData.header];
  const lines = [...header, ...sessionData.entries].map((line) => JSON.stringify(line));
  return Buffer.from(lines.join("\n")).toString("base64");
};

const filterControls = (): string =>
  FILTER_MODES.map((mode, index) => {
    const [label, title] = FILTER_TITLES[mode] ?? [mode, mode];
    return `<input type="radio" name="tree-filter" class="filter-input visually-hidden" id="filter-${mode}"${index === 0 ? " checked" : ""}><label class="filter-btn" for="filter-${mode}" title="${escapeXml(title)}">${label}</label>`;
  }).join("");

const sidebarOf = (trees: { readonly nodes: string; readonly status: string }): string =>
  `<aside id="sidebar"><div class="sidebar-header"><div class="sidebar-filters">${filterControls()}<label class="sidebar-close" for="sidebar-toggle" title="Close">✕</label></div></div><nav class="tree-container">${trees.nodes}</nav><div class="tree-status">${trees.status}</div></aside>`;

const page = (
  head: string,
  css: string,
  sidebar: string,
  content: string,
): string => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
${head}<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Session Export</title>
<style>
${css}
</style>
</head>
<body>
<input type="checkbox" id="sidebar-toggle" class="visually-hidden">
<label id="hamburger" for="sidebar-toggle" title="Open sidebar">${HAMBURGER}</label>
<label id="sidebar-overlay" for="sidebar-toggle"></label>
<div id="app">
${sidebar}
<main id="content">
${content}
</main>
</div>
</body>
</html>
`;

const renderPage = (
  sessionData: exportTypesTypes.SessionData,
  templateCss: string,
  { themeName, viewedInSrcdoc }: exportTypesTypes.ExportOptions,
): string => {
  const graph = sessionGraph(sessionData);
  const refs = entryRefs(graph);
  const times = timesOf(sessionData);
  const entries = renderEntries({
    graph,
    refs,
    renderedTools: new Map(Object.entries(sessionData.renderedTools ?? {})),
    timeOf: (id) => times.get(id),
  });
  const header = renderHeader(
    sessionData,
    formatIfSet(sessionData.header?.timestamp, "YYYY-MM-DD HH:mm:ss"),
    jsonlOf(sessionData),
  );
  const content = `<div id="header-container">${header}</div><div id="messages">${entries}</div>`;
  const css = `${themeCss(templateCss, themeName)}\n${viewCss(graph, refs)}`;
  const head = viewedInSrcdoc === true ? SRCDOC_BASE : "";
  return page(head, css, sidebarOf(renderTrees(sessionData, graph, refs)), content);
};

const renderPageModule = { renderPage };

export default renderPageModule;
