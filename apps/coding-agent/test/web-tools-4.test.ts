import { describe, expect, it } from "vite-plus/test";

import { webFetchRenderers, webSearchRenderers } from "../src/core/tools/renderers/web.ts";
import tuiKit from "./tui-kit.ts";

const { initTheme, stripAnsi, theme } = tuiKit;

function renderResult(
  renderers: typeof webSearchRenderers,
  result: { content: { type: "text"; text: string }[]; details: unknown },
  expanded: boolean,
  isError = false,
) {
  initTheme("dark");
  const component = renderers.renderResult!(result, { expanded, isPartial: false }, theme, {
    isError,
    isPartial: false,
    lastComponent: undefined,
    showImages: false,
  } as never);
  return stripAnsi(component.render(200).join("\n"));
}

const showsTheQueryAndTheUrlOn = () => {
  initTheme("dark");
  const search = webSearchRenderers.renderCall!({ query: "effect 4" }, theme, {
    lastComponent: undefined,
  } as never);
  const fetch = webFetchRenderers.renderCall!({ url: "https://example.com" }, theme, {
    lastComponent: undefined,
  } as never);
  expect(stripAnsi(search.render(200).join("\n"))).toContain("web search effect 4");
  expect(stripAnsi(fetch.render(200).join("\n"))).toContain("web fetch https://example.com");
};

const collapsesSearchResultsToACountAnd = () => {
  const result = {
    content: [{ text: "", type: "text" as const }],
    details: {
      costMicro: 0,
      results: [{ title: "Effect 4.0 released", url: "https://effect.website/blog/effect-4" }],
      servedBy: "tinyfish.web.search",
    },
  };
  expect(renderResult(webSearchRenderers, result, false)).toContain(
    "1 results, via tinyfish.web.search, $0",
  );
  const expanded = renderResult(webSearchRenderers, result, true);
  expect(expanded).toContain("Effect 4.0 released");
  expect(expanded).toContain("https://effect.website/blog/effect-4");
};

const collapsesAPageToItsTitleAnd = () => {
  const result = {
    content: [{ text: "# Example Domain\nhttps://example.com/\n\nBody", type: "text" as const }],
    details: { costMicro: 150, title: "Example Domain", url: "https://example.com/" },
  };
  const collapsed = renderResult(webFetchRenderers, result, false);
  expect(collapsed).toContain("Example Domain");
  expect(collapsed).toContain("4 lines, $0.00015");
  expect(collapsed).not.toContain("Body");
  expect(renderResult(webFetchRenderers, result, true)).toContain("Body");
};

const showsTheErrorMessage = () => {
  const result = { content: [{ text: "treg returned 401", type: "text" as const }], details: {} };
  expect(renderResult(webSearchRenderers, result, false, true)).toContain("treg returned 401");
};

describe("web tool renderers", () => {
  it("shows the query and the URL on the call line", showsTheQueryAndTheUrlOn);

  it(
    "collapses search results to a count and expands them to titles and URLs",
    collapsesSearchResultsToACountAnd,
  );

  it("collapses a page to its title and expands it to the text", collapsesAPageToItsTitleAnd);

  it("shows the error message", showsTheErrorMessage);
});
