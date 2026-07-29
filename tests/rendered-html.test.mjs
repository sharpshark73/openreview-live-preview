import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import DOMPurify from "isomorphic-dompurify";
import { lintAndFixMarkdown } from "../lib/markdown-lint-fix.mjs";
import { lintOpenReviewMarkdown } from "../lib/markdown-warnings.mjs";
import { findLiteralMatches } from "../lib/text-search.mjs";
import { getPreferredLanguage } from "../lib/language-preference.mjs";
import {
  findPostMarkdownMath,
  POST_MARKDOWN_BLOCK_BOUNDARY,
} from "../lib/post-markdown-math.mjs";
import {
  parseOpenReviewMarkdown,
  renderOpenReviewMarkdown,
  renderOpenReviewMarkdownWithAnchors,
  setOpenReviewSanitizer,
} from "../lib/openreview-renderer.mjs";

setOpenReviewSanitizer(DOMPurify);

async function renderPage() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the finished OpenReview tool", async () => {
  const response = await renderPage();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>OpenReview Live Preview<\/title>/i);
  assert.match(html, /aria-label="OpenReview Live Preview"/);
  assert.match(html, />OR<\/strong>/);
  assert.match(html, />Live Preview<\/span>/);
  assert.match(html, />复制<\/button>/);
  assert.match(html, />不同步<\/button>/);
  assert.match(html, />点击同步<\/button>/);
  assert.match(html, />自动同步<\/button>/);
  assert.match(html, />手动同步<\/button>/);
  assert.match(html, />Lint<\/button>/);
  assert.match(html, /aria-label="更多"/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /role="menu"/);
  assert.match(html, /aria-label="Switch to English"/);
  assert.match(html, />English<\/button>/);
  assert.match(html, /aria-label="查找（Ctrl\/⌘\+F）"/);
  assert.match(html, /aria-label="预览阶段"/);
  assert.match(html, />最终<\/button>/);
  assert.match(html, />Markdown<\/button>/);
  assert.match(html, /placeholder="查找"/);
  assert.match(html, /data-scope="preview"/);
  assert.match(html, /data-codemirror-editor/);
  assert.doesNotMatch(html, /<textarea[^>]+OpenReview Markdown source/);
  assert.match(html, />Preview:<\/strong>/);
  assert.doesNotMatch(html, /id="field-label"/);
  assert.doesNotMatch(html, /已保存|实时同步|正在排版公式/);
  assert.match(html, /data-rendered-html/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
  assert.doesNotMatch(html, /react-loading-skeleton/);
});

test("uses the OpenReview package versions and official Markdown linter", async () => {
  const [markedPackage, purifierPackage, markdownlintPackage] = await Promise.all([
    readFile(
      new URL("../node_modules/marked/package.json", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../node_modules/isomorphic-dompurify/package.json",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../node_modules/markdownlint/package.json", import.meta.url),
      "utf8",
    ),
  ]);

  assert.equal(JSON.parse(markedPackage).version, "15.0.6");
  assert.equal(JSON.parse(purifierPackage).version, "2.21.0");
  assert.equal(JSON.parse(markdownlintPackage).version, "0.40.0");
});

test("selects the default interface language from browser preferences", () => {
  assert.equal(getPreferredLanguage(["zh-CN"]), "zh");
  assert.equal(getPreferredLanguage(["zh-Hant-TW", "en-US"]), "zh");
  assert.equal(getPreferredLanguage(["en-GB", "zh-CN"]), "en");
  assert.equal(getPreferredLanguage(["ja-JP", "zh-CN"]), "zh");
  assert.equal(getPreferredLanguage(["fr-FR"]), "en");
  assert.equal(getPreferredLanguage([]), "en");
});

test("uses CodeMirror 6 for Markdown editing, search, lint, and source sync", async () => {
  const [packageSource, editorSource] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/source-editor.tsx", import.meta.url), "utf8"),
  ]);
  const dependencies = JSON.parse(packageSource).dependencies;

  assert.equal(dependencies.codemirror, "^6.0.2");
  assert.ok(dependencies["@codemirror/lang-markdown"]);
  assert.ok(dependencies["@codemirror/search"]);
  assert.ok(dependencies["@codemirror/lint"]);
  assert.match(editorSource, /markdownLanguage/);
  assert.match(editorSource, /openSearchPanel/);
  assert.match(editorSource, /setDiagnostics/);
  assert.match(editorSource, /getViewportCenter/);
  assert.match(editorSource, /cm-openreviewMath/);
});

test("shows MathJax's parsed input alongside formula errors", async () => {
  const [editorSource, styles] = await Promise.all([
    readFile(new URL("../app/editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(editorSource, /getMathItemsWithin/);
  assert.match(editorSource, /item\.math/);
  assert.match(editorSource, /openreviewMathSource/);
  assert.match(editorSource, /MathJax 读取到的公式/);
  assert.match(editorSource, /MathJax input/);
  assert.match(styles, /\.mathErrorTooltipFormula/);
  assert.match(styles, /user-select:\s*text/);
});

test("finds the formulas MathJax receives after Markdown rendering", () => {
  const transformed =
    "$\\widetilde{E}1=\\mathcal{E}{\\mathrm{mem}}$";
  assert.deepEqual(
    findPostMarkdownMath(transformed).map(({ math, display }) => ({
      math,
      display,
    })),
    [
      {
        math: "\\widetilde{E}1=\\mathcal{E}{\\mathrm{mem}}",
        display: false,
      },
    ],
  );

  const mixed = findPostMarkdownMath(
    "\\(a+b\\) and $$c=d$$ and \\[e=f\\]",
  );
  assert.deepEqual(
    mixed.map(({ math, display }) => ({ math, display })),
    [
      { math: "a+b", display: false },
      { math: "c=d", display: true },
      { math: "e=f", display: true },
    ],
  );

  assert.equal(
    findPostMarkdownMath(
      `$a${POST_MARKDOWN_BLOCK_BOUNDARY}b$`,
    ).length,
    0,
  );
  assert.equal(findPostMarkdownMath("\\$not math$").length, 0);
});

test("ships the Markdown-stage formula inspector", async () => {
  const [editorSource, styles] = await Promise.all([
    readFile(new URL("../app/editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(editorSource, /annotatePostMarkdownMath/);
  assert.match(editorSource, /tex2chtmlPromise/);
  assert.match(editorSource, /getMathJaxErrorMessages/);
  assert.match(editorSource, /showMarkdownMathErrors/);
  assert.match(editorSource, /MathJax input after Markdown/);
  assert.match(styles, /\.markdownMathCandidate/);
  assert.match(styles, /\.markdownMathTooltipOutput/);
  assert.match(styles, /\.markdownMathTooltipError/);
});

test("ships the AGPL license and first-visit unofficial notice", async () => {
  const [license, packageJson, pageSource, notices] = await Promise.all([
    readFile(new URL("../LICENSE.md", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8"),
  ]);

  assert.match(license, /GNU AFFERO GENERAL PUBLIC LICENSE/);
  assert.match(license, /Version 3, 19 November 2007/);
  assert.equal(JSON.parse(packageJson).license, "AGPL-3.0-or-later");
  assert.match(pageSource, /openreview-live-preview:notice:v1/);
  assert.match(pageSource, /independent, unofficial tool/);
  assert.match(pageSource, /NEXT_PUBLIC_SOURCE_URL/);
  assert.match(pageSource, /openreview-live-preview:language:v2/);
  assert.match(pageSource, /navigator\.languages/);
  assert.match(pageSource, /getPreferredLanguage/);
  assert.match(
    notices,
    /not\s+affiliated with, authorized by, or endorsed by OpenReview/,
  );
});

test("escapes valid and invalid raw HTML like OpenReview", () => {
  assert.equal(
    parseOpenReviewMarkdown("<div>some test text</div>"),
    "&lt;div&gt;some test text&lt;/div&gt;",
  );

  assert.equal(
    parseOpenReviewMarkdown(
      "# Itemized list\n1. <blah blah blah>\n2. <well well well>",
    ),
    "<h1>Itemized list</h1>\n<ol>\n<li>&lt;blah blah blah&gt;</li>\n<li>&lt;well well well&gt;</li>\n</ol>\n",
  );
});

test("renders task checkboxes as literal square brackets", () => {
  const html = parseOpenReviewMarkdown("- [x] checked\n- [ ] unchecked");
  assert.match(html, /\[x\]/);
  assert.match(html, /\[ \]/);
  assert.doesNotMatch(html, /type="checkbox"/);
});

test("allows only OpenReview-local Markdown images", () => {
  const remote = parseOpenReviewMarkdown("![plot](https://example.com/x.png)");
  assert.equal(
    remote,
    '<p>&lt;img src="https://example.com/x.png" alt="plot" title="null"&gt;</p>\n',
  );

  const local = parseOpenReviewMarkdown(
    "![GitHub](/images/github_icon.svg)",
  );
  assert.equal(
    local,
    '<p><img src="/images/github_icon.svg" alt="GitHub" class="icon" /></p>\n',
  );
});

test("sanitizes unsafe links and applies OpenReview link attributes", () => {
  const safe = renderOpenReviewMarkdown("[docs](https://openreview.net)");
  assert.match(safe, /target="_blank"/);
  assert.match(safe, /rel="noopener noreferrer"/);

  const unsafe = renderOpenReviewMarkdown("[bad](javascript:alert(1))");
  assert.doesNotMatch(unsafe, /href=/);
  assert.doesNotMatch(unsafe, /javascript:/);
});

test("preserves TeX for MathJax after Markdown parsing", () => {
  const html = renderOpenReviewMarkdown(
    String.raw`Inline $\\alpha + \\beta$.

$$
\\sum_i x_i
$$`,
  );
  assert.match(html, /\$\\alpha \+ \\beta\$/);
  assert.match(html, /\$\$\n\\sum_i x_i\n\$\$/);
});

test("adds source anchors without changing rendered blocks", () => {
  const source = "# Heading\n\nParagraph with **bold**.\n\n- one\n- two";
  const plain = renderOpenReviewMarkdown(source);
  const anchored = renderOpenReviewMarkdownWithAnchors(source);
  const withoutAnchors = anchored.replace(
    /<span class="source-anchor" data-source-start="\d+" data-source-end="\d+" hidden=""><\/span>/g,
    "",
  );

  assert.match(anchored, /data-source-start="0"/);
  assert.match(anchored, /data-source-end="\d+"/);
  assert.equal(withoutAnchors, plain);
});

test("reports conservative OpenReview-specific Markdown warnings", () => {
  const warnings = lintOpenReviewMarkdown(
    [
      "![remote](https://example.com/plot.png)",
      "",
      "<div>raw HTML</div>",
      "",
      "[unsafe](javascript:alert(1))",
      "",
      "$$x",
    ].join("\n"),
  );
  const codes = warnings.map((warning) => warning.code);

  assert.ok(codes.includes("unsupported-image"));
  assert.ok(codes.includes("raw-html"));
  assert.ok(codes.includes("unsafe-link"));
  assert.ok(codes.includes("unmatched-display-math"));
});

test("ignores warning-like text inside fenced code", () => {
  assert.deepEqual(
    lintOpenReviewMarkdown(
      "```\n<div>example</div>\n$$\n![x](https://example.com/x.png)\n```",
    ),
    [],
  );
  assert.equal(
    lintOpenReviewMarkdown("```js\nconst value = 1;")[0]?.code,
    "unclosed-fence",
  );
  assert.equal(
    lintOpenReviewMarkdown("<https://openreview.net>").some(
      (warning) => warning.code === "raw-html",
    ),
    false,
  );
});

test("detects broken emphasis and Markdown-damaged TeX", () => {
  const brokenHeading = String.raw`## **W\*\*\*\*1\*\*\*\* \& Q3\.\*\*\*\* Unclear Motivation`;
  const brokenLabel = String.raw`**|**Stage I — \*\*\*\*I\*\*\*\*nitialization**|||`;
  const inlineFormula =
    String.raw`3. $\widetilde{E}_1=\mathcal{E}_{\mathrm{mem}}$`;

  assert.ok(
    lintOpenReviewMarkdown(brokenHeading).some(
      (warning) => warning.code === "escaped-emphasis",
    ),
  );
  assert.ok(
    lintOpenReviewMarkdown(brokenLabel).some(
      (warning) => warning.code === "unmatched-strong",
    ),
  );
  assert.ok(
    lintOpenReviewMarkdown(inlineFormula).some(
      (warning) => warning.code === "markdown-emphasis-in-math",
    ),
  );
  assert.equal(
    lintOpenReviewMarkdown(
      String.raw`$\widetilde{E}\_1=\mathcal{E}\_{\mathrm{mem}}$`,
    ).some((warning) => warning.code === "markdown-emphasis-in-math"),
    false,
  );
  assert.ok(
    lintOpenReviewMarkdown(
      "Table R14 reports pairwise **cosine similarities **among features.",
    ).some((warning) => warning.code === "strong-inner-whitespace"),
  );
  assert.equal(
    lintOpenReviewMarkdown(
      "Table R14 reports pairwise **cosine similarities** among features.",
    ).some((warning) => warning.code === "strong-inner-whitespace"),
    false,
  );
});

test("detects inline TeX split across Markdown blocks", () => {
  const source = String.raw`1. Suppress the initial-frame output mask to empty.

    We uniformly shift its logits:

    $\widetilde{Z}^{\mathrm{empty}}_1
=
\widetilde{Z}_1-\max\left(\widetilde{Z}_1\right),$

    The output mask is empty.`;
  const codes = lintOpenReviewMarkdown(source).map(
    (warning) => warning.code,
  );

  assert.ok(codes.includes("multiline-inline-math"));
  assert.ok(codes.includes("indented-code"));
});

test("Lint applies only conservative markdownlint fixes", () => {
  const fixed = lintAndFixMarkdown(
    "##  Heading\n\n\n\nHere is ** bold ** text.",
  );
  assert.equal(fixed.text, "## Heading\n\nHere is **bold** text.\n");
  assert.ok(fixed.fixedCount > 0);

  const adjacentWord = "Table **cosine similarities **among features.";
  assert.equal(lintAndFixMarkdown(adjacentWord).text, `${adjacentWord}\n`);

  const tex = String.raw`$\widetilde{E}_1=\mathcal{E}_{\mathrm{mem}}$`;
  assert.equal(lintAndFixMarkdown(tex).text, `${tex}\n`);

  const hardBreak = "first line  \nsecond line";
  assert.equal(lintAndFixMarkdown(hardBreak).text, `${hardBreak}\n`);
});

test("finds literal text with optional case sensitivity", () => {
  assert.deepEqual(findLiteralMatches("Alpha alpha ALPHA", "alpha"), [
    { start: 0, end: 5 },
    { start: 6, end: 11 },
    { start: 12, end: 17 },
  ]);
  assert.deepEqual(findLiteralMatches("Alpha alpha ALPHA", "alpha", true), [
    { start: 6, end: 11 },
  ]);
  assert.deepEqual(findLiteralMatches("aaaa", "aa"), [
    { start: 0, end: 2 },
    { start: 2, end: 4 },
  ]);
  assert.deepEqual(findLiteralMatches("text", ""), []);
});
