import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const basePath =
  process.env.GITHUB_PAGES === "true"
    ? "/openreview-live-preview"
    : "";
const html = await readFile(
  new URL("../dist/client/index.html", import.meta.url),
  "utf8",
);

assert.match(html, /<title>OpenReview Live Preview<\/title>/);
assert.match(
  html,
  new RegExp(
    `(?:src|href)="${basePath.replaceAll("/", "\\/")}\\/assets\\/`,
  ),
);

console.log(
  `Verified static export${basePath ? ` at ${basePath}` : " at site root"}.`,
);
