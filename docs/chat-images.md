# Chat images contract

Pi Durable 1.5.0 accepts a `UserMessage["content"]` array in `root.submit({type: "input", content, requestId})`. Gaia submits real `{type: "image", data, mimeType}` blocks, with a text block first when text is present. The installed Pi AI README Image Input example and Pi Durable `dist/harness/types.d.ts` define this contract. Images are never described to the model as base64 text.

## Upload and read

`POST /api/v1/attachments` accepts exactly `{id, name, mimeType, data}`. `id` is an opaque UUID chosen once per draft image. `data` is canonical base64, without a data-URL prefix. Supported types are PNG, JPEG and WebP. Each original file is at most 10 MiB. Prepared images are at most 3 MiB and 2000 by 2000 pixels, or the selected model’s smaller preparation limits. A message contains at most four unique image references. Empty text is valid only with an image.

The server checks canonical base64, byte count, declared format, container boundaries and dimensions, then uses Pi’s installed Photon image processor to decode each image. Images needing orientation, resizing or a smaller byte budget are re-encoded. Upright images already within limits retain their original bytes, including any EXIF, GPS or other metadata. Prepared output is validated again before storage. Corrupt pixel payloads are rejected before a provider request. Input dimensions are bounded to 50 megapixels and 20000 pixels per side before decoding. Preparation runs in Pi’s worker, whose idle memory is released after two seconds. No SVG, GIF or arbitrary client filesystem paths are accepted.

Prepared image bytes stay below both Gaia’s 3 MiB storage limit and Pi’s base64 budget. Original upload fingerprints keep retries idempotent when preparation changes the bytes or format. The model receives prepared pixels, and sent thumbnails use those same prepared files.

Success returns 201 and `{id, name, mimeType, size}`. The display name has path separators, control characters and format characters removed. It never becomes a filesystem path. The same upload ID and content return the same reference. Conflicting reuse is refused.

`GET /api/v1/attachments/<UUID>` returns bounded prepared bytes with their validated image MIME type, no-store, nosniff and a sandbox CSP. Only a connected session can upload or read. Existing trusted host, origin, same-site and managed authentication boundaries apply. Uploads also use release admission and idle-run guards. Preparation is an admitted control operation, so release drain and shutdown wait for it. Client cancellation aborts admission before file storage. Interrupted control operations reopen idle instead of offering to retry the last unrelated chat message. Shutdown refuses new writes. Requests exceeding the upload body bound return 413. Invalid uploads return 400, and unsupported models return 409 before model submission.

## Persistence and retry

Each generation contains `attachments/<UUID>.json` beside `gaia.sqlite`, with directory mode 0700 and file mode 0600. Each immutable file contains the reference metadata and base64. Writes use an exclusive temporary file, flush and rename. UUID validation and no-follow file reads prevent traversal and symlink file reads. The directory itself cannot be a symlink. No SQLite schema changes are needed.

Thread JSON gains optional `attachments` references on user messages. SSE and snapshots carry references, never image bytes. Text-only histories stay valid. The files are included in existing whole-generation copies, backups and rollback. Pi also retains submitted image blocks in its own durable history.

`POST /api/v1/messages` adds optional `attachments: UUID[]` to the existing `{requestId, text}` body. Duplicate admission returns 200, including while the original is running. Reusing a request ID with different content returns 409. Message records also repair duplicate detection after a crash between saving history and writing the request index. A failed reply retains the original text, image references and model/effort selection. Retry reloads and validates those files before submitting to Pi. Missing images produce a recoverable refusal and no new provider call. Stop and shutdown abort and join the same model operation.

Unsent uploads are retained so a browser draft can recover after restart or release changes. No automatic deletion runs while browser references may exist. Operator cleanup must preserve files referenced by retained messages and active drafts. Total generation size remains part of the owner's normal data-directory backup and disk monitoring.

## Browser draft and composer

The browser retains drafts in the `gaia-chat-drafts` IndexedDB database. The `drafts` store keeps version 2 metadata `{requestId, text, imageIds}` under key `local`; the `images` store keeps each image's UUID, MIME type, display name and base64 under its UUID. Text edits rewrite only small metadata. Image bytes are written once per UUID in the same transaction as their draft reference. Old combined drafts and session text migrate on first use. This is a browser-side copy in addition to generation-local server storage. IndexedDB writes coalesce and serialise. A release reload waits for the latest draft transaction, file reads, model selection, an active send and IME composition. A corrupt saved draft exposes Retry draft and is not overwritten with empty data. Failed saves retain the in-memory draft and expose Retry saving.

Attach images is in the left plus menu for image-capable models. File selection, paste and drop use the same bounds and duplicate-byte removal. Object URLs for thumbnails are revoked on removal, change and unmount. Upload cancellation keeps the draft. A request ID changes only when the draft changes. Unknown admission after a network failure reuses the original ID. An admitted message clears only its own draft, leaving newer edits intact. A later provider failure leaves the full message in the transcript and exposes Try again, using server-retained image references.

The model and effort popover uses the installed Apache-2.0 React Aria controls and existing MIT Board UI components. It displays only reported capability values, with keyboard radio selection and an accessible discrete Reasoning effort range. Models without capability metadata retain the old model-only behaviour. Models with one supported effort have no fake effort scale. Compact context remains in the real chat-actions menu.

## Verification boundary

`apps/server/attachments.test.ts` exercises real Pi with a deterministic faux-provider, image-only and mixed input, retries after reopen, retained effort, duplicate concurrent admission, bounds, guards, file permissions, symlinks, cancellation and unsupported models. `apps/web/chat-draft.test.ts` checks image bytes and admission identity after reopen, failed storage, newer edits, write coalescing, duplicate files and bounds. These checks do not establish live subscription-provider or native Electron behaviour. Parent acceptance includes dark and light themes, 320px width, keyboard effort changes, paste and drop, IME, thumbnail removal, upload cancellation, network failure, release reload and service restart.

Image preparation regressions also cover full decoding, corrupt compressed data, oversized dimensions, resized and re-encoded files, idempotent prepared uploads, cancellation, shutdown drain and an interrupted-operation SQLite snapshot reopened without a provider call.
