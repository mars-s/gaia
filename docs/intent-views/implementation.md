# Intent views implementation record

Owner authority: 8 November 2026 task brief. SPEC changes 1 to 9 in the Opus product plan are approved. The conditional local decision model sentence is excluded. Skullet, Torph and WebHaptics are approved for use now, overriding the plan's wait dates. The hosted decision provider exception remains proposed.

Scope is the first demo described in sections 2 to 6 and build order A to F of `/Users/avi/Developer/vibe/gaia/data/verification/northstar/product-plan.md`. The user's "section 4" refers to the nine exact changes actually in section 8 of that file.

Workflow: record approved wording, build additive envelopes and local file foundations, verify queries and bounded parsing, build the disabled decision seam, then implement and capture the shared view kit after B0. Each code concern needs both typechecks, lint and focused tests before committing. Final verification needs build, protocol and a serial full suite with machine load recorded.

B0 is a required dependency before UI code. The plan requires `data/verification/northstar/view-kit-direction.md`, authored by Opus, with owner-visible frames. Only `product-plan.md` exists in that directory. This implementation sub-agent cannot delegate or replace the missing design direction. B1 onward and the first demo remain blocked until the master supplies B0. The existing UI and protected core are unchanged.

No owner install, credential, data or process is used. Fixtures and tests use temporary directories. The plan was read from the expressly authorised path only.

Renderer independence: `packages/protocol/files.ts` and `views.ts` contain plain typed data and Zod schemas only. They import no React, DOM, CSS or browser types. Part-specific validation and rendering belong to the future kit registry, never to the shared envelope. Rune is a possible later native renderer, not a client migration in this increment.

Implemented foundations: additive file and view envelopes, content-addressed file upload at `POST /api/v1/files`, bounded workers, CSV typing, DOCX document tree, PDF text and outline, typed local queries and exact-span quote verification. Original bytes are read-only. Intake drains before quiesce and shutdown. A single-column one-million-row CSV parsed in 823 ms on this machine in the bounded worker. This is one scale fixture, not a guarantee across every million-row CSV. The existing HTTP gates still protect upload.

The decision service is disabled by default and stores only cost reservations in SQLite, not prompts, keys or raw provider responses. An injected plan-model callback and the local matcher are fallback implementations. There is no production hosted adapter, key handling or setting UI. The cap tests use a fake provider only. Confirmed charges may release unused reservations; uncertain failures retain the maximum reserved charge. Calendar months are measured in UTC at dispatch.

Still required: B0 design direction and owner-visible frames; all shared kit renderers, galleries and six-judge scoring; file drop and chips; model context packing and `show_view`; message persistence and refinement; motion and library fitness trials; saved JSON Canvas, canvas operations and undo; suggestions and spaces navigation; background demo captures and recording. Parser acceptance also needs broader fixtures including encrypted PDFs, nested lists and image placeholders. No view can yet be requested or drawn in the app. The envelope alone is not the kit registry, rendering validation or grounding gate.

The plan's first demo has not been captured. No screenshots or recording exist for it. No window, Dock icon, agent-desktop session or owner runtime was opened.
