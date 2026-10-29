import testing from "@msa/testing";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import exportHtml from "../src/core/export-html/index.ts";
import type sessionManagerTypes from "../src/core/session-manager.types.ts";
import sessionFormat from "../src/core/session-manager/session-format.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";

const { CURRENT_SESSION_VERSION } = sessionFormat;
const { exportFromFile } = exportHtml;
const { initTheme } = themeModule;

const {
  awaited,
  isoFromMillis,
  joinPath,
  makeTempDir,
  readTextFile,
  removePath,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

const dirs = { temp: "" };

const USAGE = {
  cacheRead: 0,
  cacheWrite: 0,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
  input: 0,
  output: 0,
  totalTokens: 0,
};

const SKILL_TEXT =
  '<skill name="review" location="/skills/review/SKILL.md">\n# Review\n\n- step **one**\n</skill>\n\nplease review';

const entries: sessionManagerTypes.SessionEntry[] = [
  {
    id: 'u"1',
    message: {
      content: [
        { text: "<b>raw</b> [bad](javascript:alert(1)) [good](https://example.com)", type: "text" },
        { data: "AAAA", mimeType: 'image/png" onerror="x', type: "image" },
      ],
      role: "user",
      timestamp: 0,
    },
    parentId: null,
    timestamp: isoFromMillis(0),
    type: "message",
  },
  {
    id: "a1",
    message: {
      api: "anthropic-messages",
      content: [{ text: "```ts\nconst x = 1;\n```", type: "text" }],
      model: "<model>",
      provider: "<provider>",
      role: "assistant",
      stopReason: "stop",
      timestamp: 1,
      usage: USAGE,
    },
    parentId: 'u"1',
    timestamp: isoFromMillis(1000),
    type: "message",
  },
  {
    id: "m1",
    modelId: "<script>model</script>",
    parentId: "a1",
    provider: "p",
    timestamp: isoFromMillis(2000),
    type: "model_change",
  },
  {
    id: "s1",
    message: { content: [{ text: SKILL_TEXT, type: "text" }], role: "user", timestamp: 3 },
    parentId: "m1",
    timestamp: isoFromMillis(3000),
    type: "message",
  },
];

const exportSessionWith = (viewedInSrcdoc: boolean) =>
  Effect.gen(function* () {
    const header = {
      cwd: dirs.temp,
      id: "<session>",
      timestamp: isoFromMillis(0),
      type: "session" as const,
      version: CURRENT_SESSION_VERSION,
    } satisfies sessionManagerTypes.SessionHeader;
    const sessionPath = joinPath(dirs.temp, "session.jsonl");
    const lines = yield* Effect.forEach([header, ...entries], toJsonText);
    yield* writeTextFile(sessionPath, `${lines.join("\n")}\n`);
    return yield* readTextFile(
      yield* awaited(
        exportFromFile(sessionPath, {
          outputPath: joinPath(dirs.temp, "out.html"),
          viewedInSrcdoc,
        }),
      ),
    );
  });

const exportSession = exportSessionWith(false);

const resolvesLinksInsideTheShareViewer = Effect.gen(function* () {
  expect(yield* exportSessionWith(true)).toContain('<base href="about:srcdoc">');
  expect(yield* exportSession).not.toContain("<base");
});

const rendersWithoutScripts = Effect.gen(function* () {
  const html = yield* exportSession;
  expect(html).not.toMatch(/<script/iu);
  expect(html).toContain(
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\';',
  );
});

const escapesSessionFields = Effect.gen(function* () {
  const html = yield* exportSession;
  expect(html).toContain("&lt;b&gt;raw&lt;/b&gt;");
  expect(html).not.toContain('href="javascript:');
  expect(html).toContain('<a href="https://example.com">good</a>');
  expect(html).toContain('id="entry-u&quot;1"');
  expect(html).toContain("data:image/png&quot; onerror=&quot;x;base64,AAAA");
  expect(html).toContain("&lt;provider&gt;/&lt;model&gt;");
  expect(html).toContain("[model: &lt;script&gt;model&lt;/script&gt;]");
  expect(html).toContain("Session: &lt;session&gt;");
});

const highlightsCodeAtExport = Effect.gen(function* () {
  const html = yield* exportSession;
  expect(html).toMatch(/<pre><code class="hljs"><span class="hljs-keyword">const<\/span>/u);
});

const rendersSkillBlocks = Effect.gen(function* () {
  const html = yield* exportSession;
  expect(html).toContain(
    '<details class="skill-invocation follows-tools"><summary><div class="skill-invocation-label">[skill] review</div>',
  );
  expect(html).toContain("<strong>one</strong>");
  expect(html).toContain(
    '<div class="user-message"><div class="markdown-content"><p>please review</p>',
  );
  expect(html).not.toContain("&lt;skill name=");
  expect(html).toContain('<span class="tree-role-skill">skill:</span> review');
});

describe("export HTML document", () => {
  beforeAll(() =>
    runTest(
      Effect.gen(function* () {
        initTheme("dark");
        dirs.temp = yield* makeTempDir("msa-export-html-");
      }),
    ),
  );

  afterAll(() => runTest(removePath(dirs.temp)));

  it("renders the session without scripts and denies them by content security policy", () =>
    runTest(rendersWithoutScripts));

  it("resolves in-page links against the srcdoc document only for the share viewer", () =>
    runTest(resolvesLinksInsideTheShareViewer));

  it("escapes session fields in text and attributes", () => runTest(escapesSessionFields));

  it("highlights code blocks when exporting", () => runTest(highlightsCodeAtExport));

  it("renders skill blocks as a collapsible invocation and a user message", () =>
    runTest(rendersSkillBlocks));
});
