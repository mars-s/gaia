# Chat images contract

Pi Durable 1.5.0 accepts a `UserMessage["content"]` array in `root.submit({type: "input", content, requestId})`. Gaia submits real `{type: "image", data, mimeType}` blocks, with a text block first when text is present. The installed Pi AI README Image Input example and Pi Durable `dist/harness/types.d.ts` define this contract. Images are never described to the model as base64 text.

## Upload and read

`POST /api/v1/attachments` accepts exactly `{id, name, mimeType, data}`. `id` is an opaque UUID chosen once per draft image. `data` is canonical base64, without a data-URL prefix. Supported types are PNG, JPEG and WebP. Each decoded file is at most 3 MiB. A message contains at most four unique image references. Empty text is valid only with an image.

The server checks base64, byte count, format signature and basic container boundaries before writing or submitting. It does not promise to decode or resize every image. PNG requires its signature, nonzero IHDR dimensions and IEND. JPEG requires start and end markers. WebP requires a matching RIFF length and a supported VP8 container. A corrupt compressed payload can still be rejected by the provider. The 3 MiB limit keeps base64 below Pi's installed default 4.5 MiB image budget. No SVG, GIF or arbitrary client filesystem paths are accepted.

Success returns 201 and `{id, name, mimeType, size}`. The display name has path separators, control characters and format characters removed. It never becomes a filesystem path. The same upload ID and content return the same reference. Conflicting reuse is refused.

`GET /api/v1/attachments/<UUID>` returns bounded original bytes with their validated image MIME type, no-store, nosniff and a sandbox CSP. Only a connected session can upload or read. Existing trusted host, origin, same-site and managed authentication boundaries apply. Uploads also use release admission and idle-run guards. Shutdown refuses new writes. Requests exceeding the upload body bound return 413. Invalid uploads return 400, and unsupported models return 409 before model submission.

## Persistence and retry

Each generation contains `attachments/<UUID>.json` beside `gaia.sqlite`, with directory mode 0700 and file mode 0600. Each immutable file contains the reference metadata and base64. Writes use an exclusive temporary file, flush and rename. UUID validation and no-follow file reads prevent traversal and symlink file reads. The directory itself cannot be a symlink. No SQLite schema changes are needed.

Thread JSON gains optional `attachments` references on user messages. SSE and snapshots carry references, never image bytes. Text-only histories stay valid. The files are included in existing whole-generation copies, backups and rollback. Pi also retains submitted image blocks in its own durable history.

`POST /api/v1/messages` adds optional `attachments: UUID[]` to the existing `{requestId, text}` body. Duplicate admission returns 200, including while the original is running. Reusing a request ID with different content returns 409. Message records also repair duplicate detection after a crash between saving history and writing the request index. A failed reply retains the original text, image references and model/effort selection. Retry reloads and validates those files before submitting to Pi. Missing images produce a recoverable refusal and no new provider call. Stop and shutdown abort and join the same model operation.

Unsent uploads are retained so a browser draft can recover after restart or release changes. No automatic deletion runs while browser references may exist. Operator cleanup must preserve files referenced by retained messages and active drafts. Total generation size remains part of the owner's normal data-directory backup and disk monitoring.

## Verification boundary

`apps/server/attachments.test.ts` exercises real Pi with a deterministic faux-provider, image-only and mixed input, retries after reopen, retained effort, duplicate concurrent admission, bounds, guards, file permissions, symlinks, cancellation and unsupported models. These checks do not establish live subscription-provider or native Electron behaviour.
