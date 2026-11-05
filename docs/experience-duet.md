# Shared-channel memory

One assistant identity serves separate channel conversations. The `channels` layout shares explicit memory within its profile. It does not share channel transcripts. New profiles start empty and do not infer facts from old owner history.

Admission freezes the job's prompt context, selected facts and memory revision. A later write by another job does not change that prompt. An explicit `read_memory` call reads the latest committed facts in the caller's permitted namespace, including facts written since admission and facts written by the same job.

## Tool contract

`read_memory` returns the existing JSON array of fact records in append order. Every record retains its revision, key, value, source scope, source job and creation timestamp. An empty array means the namespace revision is zero. Otherwise the final record's revision is the `expectedRevision` for the next `remember_fact` call. Revisions can have gaps because revision numbers are allocated across the profile, while reads and write checks use the permitted namespace.

`remember_fact` rejects a stale `expectedRevision` with `Memory revision changed. Read it again.` The caller can explicitly read again and retry with the latest revision. Another writer can still race that retry, so success always depends on the atomic write check.

Writing the same key appends another record. The previous record remains auditable. For a current value, use the last record for that key. The read result preserves every version rather than collapsing history. A rejected write appends no record.

## Context boundaries

Reading shared facts returns only explicit fact records and their provenance. It does not retrieve the source channel's messages or answers. `retrieve_context` retains its existing admission-time current-scope limit and requires an explicit scope selection to retrieve another channel's history.

The `bots` and `sessions` layouts keep separate memory namespaces per scope. A write in one scope cannot become visible through another scope's `read_memory`. Separate profiles have separate stores for all layouts.

## Verification

`apps/server/experience-duet.test.ts` uses the real Pi fixture, temporary stores, ephemeral loopback HTTP servers and faux model responses that invoke actual tools. It holds two concurrent channel jobs before either writes, checks a stale write conflict, then reads and retries. It checks same-job visibility, append-only updates, source provenance, channel transcript privacy, Bot and session isolation, and separate-profile isolation.

The restart case compares the complete public profile and both scope states before and after reopening. The existing startup transaction advances the public runtime revision by one, which the test checks separately. All other public fields must match exactly. It checks that reopening makes zero provider calls, then explicitly requests a read and compares every restored fact field, including timestamps and source IDs.

These fixtures do not prove real subscription, native app or managed acceptance. The master owns those checks. No managed feature is enabled by this change.
