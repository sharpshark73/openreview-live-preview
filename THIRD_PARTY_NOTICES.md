# Third-party notices

## OpenReview Live Preview

OpenReview Live Preview is an independent, modified implementation released
under the GNU Affero General Public License version 3 or later. It is not
affiliated with, authorized by, or endorsed by OpenReview.

The original portions of this project are Copyright © 2026 OpenReview Live
Preview contributors. Modifications are documented in this repository's Git
history. The complete license is included in
[LICENSE.md](./LICENSE.md), and the corresponding source is published at
[sharpshark73/openreview-live-preview](https://github.com/sharpshark73/openreview-live-preview).

## OpenReview web

This project intentionally reproduces the Markdown and TeX rendering behavior
of the official [openreview/openreview-web](https://github.com/openreview/openreview-web)
project.

The compatibility implementation was checked against upstream commit
`553a5a65fe7ba269aeaa5c56c06a6b84356d03f4` (OpenReview web v1.15.25,
2026-07-21), especially:

- `client/view.js` (`setupMarked`)
- `lib/mathjax-config.js`
- `app/MathjaxScript.js`
- `styles/utils/_mixins.scss` (`markdown-content-styles`)
- `styles/components/note-content.scss`

OpenReview web is licensed under the GNU Affero General Public License v3.0 or
later. See the upstream
[license](https://github.com/openreview/openreview-web/blob/main/LICENSE.md).

OpenReview and its logo are marks of the OpenReview project. No OpenReview logo
is distributed with this project.

## markdownlint

The `Lint` action uses
[markdownlint 0.40.0](https://github.com/DavidAnson/markdownlint), distributed
under the MIT License. Its checked-in browser bundle is generated from the
installed package and includes markdownlint's MIT-licensed runtime
dependencies. Their package metadata and license files remain available under
`node_modules` after installation.

## fast-diff

Formula comparisons use
[fast-diff 1.3.0](https://github.com/jhchen/fast-diff), distributed under the
Apache License 2.0.
