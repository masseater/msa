import { describe, expect, it } from "vite-plus/test";

import htmlDocumentModule from "../src/utils/html-document.ts";

const { htmlDocument, htmlReply, writeHtmlFile } = htmlDocumentModule;

const POLICY_META = '<meta http-equiv="Content-Security-Policy" content="';

const policyOf = (html: string): string => {
  const start = html.indexOf(POLICY_META) + POLICY_META.length;
  return html.slice(start, html.indexOf('"', start));
};

const injected = htmlDocument({
  body: '<p>x</p><script>alert(1)</script><SCRIPT src="a.js"></SCRIPT ><Script\n>b</Script>',
  head: "<script>head()</script>",
  htmlAttributes: { "data-theme": '"><script>attr()</script>' },
  style: "body{}</style><script>style()</script>",
  title: "</title><script>title()</script>",
});

describe("htmlDocument", () => {
  it("denies scripts and outside requests by a content security policy in the head", () => {
    const html = htmlDocument({ body: "<p>x</p>", style: "", title: "t" });
    expect(html.startsWith("<!doctype html>\n<html")).toBe(true);
    expect(html.indexOf(POLICY_META)).toBeLessThan(html.indexOf("<title>"));
    expect(policyOf(html)).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'",
    );
  });

  it("allows only the image sources it is given", () => {
    const html = htmlDocument({
      body: "",
      imageSources: ["data:", "https:"],
      style: "",
      title: "t",
    });
    expect(policyOf(html)).toBe(
      "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; form-action 'none'",
    );
  });

  it("writes no script tag whatever its parts contain", () => {
    expect(injected).not.toMatch(/<\/?script/iu);
    expect(injected).toContain("&lt;script>alert(1)&lt;/script>");
    expect(injected).toContain("&lt;SCRIPT src=");
  });

  it("escapes the title and attribute values", () => {
    expect(injected).toContain("<title>&lt;/title&gt;&lt;script&gt;title()&lt;/script&gt;</title>");
    expect(injected).toContain('data-theme="&quot;&gt;&lt;script&gt;attr()&lt;/script&gt;"');
  });
});

describe("html-document exits", () => {
  const page = htmlDocument({ body: "<p>x</p>", style: "", title: "t" });

  it("serves a document as text/html that browsers do not cache", () => {
    expect(htmlReply(404, page)).toEqual({
      body: page,
      headers: { "cache-control": "no-store", "content-type": "text/html; charset=utf-8" },
      status: 404,
    });
  });

  it("hands the document to the writer it is given", () => {
    const written: Array<readonly [string, string]> = [];
    writeHtmlFile((path, data) => written.push([path, data]), "out.html", page);
    expect(written).toEqual([["out.html", page]]);
  });
});
