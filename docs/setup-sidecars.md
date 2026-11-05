# Setup proposals and main chat

Setup plans and their exact revisions stay in each setup's Pi database. Proposal metadata lives separately in `experiences/<id>/proposal.json`. Version 1 records creation, trusted source, optional answer binding, dismissal and replacement. New manual API proposals have a manual source. Legacy proposals have no inferred conversation. Dismissing one records an explicit legacy source. Writes use atomic replacement and mode 0600.

The index adds optional `proposal` metadata. Old response parsers can ignore it. Old GOOD ignores the sidecar files. No SQL, Pi document kind, task kind, message copy or migration was added. Index order uses creation time, earliest conversation time and ID. Pending legacy records without either time sort by ID.

`POST /api/v1/experiences/:id/dismiss` accepts an empty object, keeps the database and is idempotent. Ready setups return 409. Replacement affects pending proposals from the same trusted conversation only. Both remain reviewable through Settings, Setups.

`GET /api/v1/experiences/main` reads the reversible version 1 pointer. `PUT` accepts `{profileId: UUID | null}`. It requires a ready setup or null for Earlier chat, and uses the existing host, origin, body and write guards. This is the only new PUT route. The pointer does not start model work.

Confirming through the public API retains its existing semantics. The inline Use action confirms the displayed revision, then writes main and opens the setup. These are separate operations. If main selection fails, the card reports that the setup was created and offers retry. Retry reads the ready setup and writes the pointer without confirming again. A stale revision remains inline and does not navigate.

New clients honour the server pointer. A saved scope is restored only within the matching setup. A server without the main endpoint retains the earlier compatible local-selection restore. Navigation and draft guards reject delayed restoration or confirmation navigation. Safe mode continues to render Earlier chat and does not read main.

Verification uses temporary real Pi stores and faux providers. The synthetic 35-message owner fixture and skipped personal details remain byte-identical when main is set, cleared and reopened. The sidecars pass the existing schema compatibility check. The parent still owns old-GOOD executable recovery, complete serial integration and native 320/1000 px light/dark acceptance.
