# Hosting constraints for tool authors

Kitlane hosts static files. It runs no builds and no user server code. Read this before promising that a builder's export will work.

## The release base path

Every published version is immutable and is served from its own path on the tool's stable origin:

```
https://app-<id>.sites.<domain>/_releases/<versionId>/index.html
```

The shell always opens a version-qualified path, and a request to an unversioned path on the tool origin redirects (`302`, not cacheable) to the active version. Consequences:

- **Use relative asset URLs** (`./app.js`, `styles.css`, `images/logo.png`) or configure your bundler's base path to be relative (Vite: `base: "./"`; esbuild: relative imports; Create React App: `"homepage": "."`). Root-absolute URLs such as `/app.js` resolve to the origin root and will not find your file.
- The only root-absolute path that is correct is `/._kitlane/...`, which is the SDK and data API on your own origin.
- Pages that are already open keep their version until the user launches again; fresh launches get the active version. Rollback changes code, not stored data.
- Single-page applications: an unknown path without a file extension inside a release serves that release's `index.html`, so client-side routers and deep links work. Paths with extensions must exist as files.

## Reserved paths

Your upload cannot contain these top-level names: `._kitlane`, `_releases`, `.auth`, `.dev`, `.kitlane`, `.well-known`. Hosted files can never shadow the SDK or data routes.

## Rejected content

Repository history (`.git`, `.svn`, `.hg`), environment files (`.env`, `.env.*`), key material (`*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`), `.npmrc`, `.netrc`, symbolic links, path traversal, absolute paths, and duplicate paths that differ only by case. The CLI excludes most of these before upload and honours a `.kitlaneignore` file.

## Allowed file types

By default (operators may change the list with `KITLANE_ALLOWED_EXTENSIONS`):

`html htm js mjs cjs css map json webmanifest txt md csv xml svg png jpg jpeg gif webp avif ico bmp woff woff2 ttf otf eot mp3 ogg wav mp4 webm pdf wasm`

Files without an extension are rejected. `index.html` must be at the root of the upload; a single HTML file is packaged as `index.html` automatically.

## Limits (defaults)

| Limit | Default | Environment variable |
|---|---|---|
| Upload size | 50 MB | `KITLANE_MAX_UPLOAD_BYTES` |
| Files per upload | 2000 | `KITLANE_MAX_FILES` |
| Single file | 20 MB | `KITLANE_MAX_FILE_BYTES` |
| Document size | 256 KB | `KITLANE_MAX_DOC_BYTES` |
| Bulk operations per request | 500 | `KITLANE_MAX_BULK_DOCS` |
| Documents per collection | 20000 | `KITLANE_MAX_DOCS_PER_COLLECTION` |
| Personal storage per user per tool | 20 MB | `KITLANE_PERSONAL_QUOTA_BYTES` |
| Shared collection storage | 200 MB | `KITLANE_SHARED_QUOTA_BYTES` |
| Data requests per user per tool | 600 per minute | `KITLANE_REQUESTS_PER_MINUTE` |
| List page size | 200 | `KITLANE_LIST_LIMIT_MAX` |

Large binary files belong in a future object-storage capability, not in JSON documents.

## Content Security Policy

Hosted responses carry `default-src 'self'` with inline scripts and styles allowed, `img-src` and `font-src` allowing `data:` (and `blob:` for images), `connect-src 'self'`, `frame-src 'none'`, `object-src 'none'`, and `frame-ancestors` limited to the tool itself and the portal. External CDNs, web fonts, analytics, and third-party APIs are blocked unless the operator adds them to `KITLANE_HOSTED_SCRIPT_SRC`, `KITLANE_HOSTED_STYLE_SRC`, `KITLANE_HOSTED_FONT_SRC`, `KITLANE_HOSTED_IMG_SRC`, `KITLANE_HOSTED_CONNECT_SRC`, or `KITLANE_HOSTED_FRAME_SRC`. Bundle your dependencies locally. `eval` is blocked by default. A restrictive `Permissions-Policy` disables camera, microphone, geolocation, payment, USB, and MIDI unless the operator changes `KITLANE_HOSTED_PERMISSIONS_POLICY`.

## The shell

Hosted tools open inside a cross-origin iframe with the sandbox flags `allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals`. Your tool keeps its own origin, cookies, and storage. `window.top` is the portal and is cross-origin; use `kitlane.shell.setTitle()` to update the tab title and `target="_blank"` or `_top` on links that should leave the frame. **Open directly** reaches your origin without the shell; design for both.

## Checking an export before publishing

1. Build the project and look at `index.html`: are script and link URLs relative? If they start with `/` (other than `/._kitlane/`), fix the base path.
2. Does the output contain only allowed file types and no source maps you would rather not ship? (`.map` is allowed; it is your choice.)
3. Does the app fetch external APIs or load external scripts or fonts? They will be blocked unless the operator allowlists them.
4. Does it rely on `eval` or `new Function`? Blocked by default.
5. Does it use `localStorage` for important state? That stays in one browser. Use `kitlane.user.collection()` for state that should follow the person across devices.
6. Does it need a backend? Kitlane does not run one. Register the tool as an external URL instead, or restructure around shared collections refreshed by an external updater.
7. Publish to a test name first (`kitlane publish ./dist --name mytool-test`), open it in the shell and directly, then publish to the real name.
