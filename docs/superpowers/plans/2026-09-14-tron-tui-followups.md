# tron v1 — deferred findings

Minor findings logged by task and final reviews during the 2026-09-14 build, triaged as defer. Source: the SDD ledger, now deleted.

Task 1: minor (deferred): src/sql.ts should carry a one-line comment that classify is a UX heuristic, the READ ONLY transaction is the safety boundary; add the three fail-open inputs as regression tests
Task 1: minor (deferred): tableQuery `select *` without ORDER BY makes limit/offset paging non-deterministic
Task 1: minor (deferred): @types/node ^26 vs engines >=22 — pin @types/node@22 so tsc catches newer-than-floor APIs
Task 2: minor (deferred): selectProfile crashes on prototype-named profiles (`toString`) — use `names.includes(chosen)` instead of `!profile` (src/config.ts:54)
Task 2: minor (deferred): loadConfig reports every read failure as "not found" — append the fs error message
Task 2: minor (deferred): loadConfig has no test; `connections` as a JSON array passes validation; literal `$` in a URL has no escape (document `%24` in README)
Task 3: minor (deferred): scripts/smoke.ts is not idempotent (absolute counts, commits a row); re-seed before re-running
Task 3: minor (deferred): isConnectionError misses postgres.js CONNECT_TIMEOUT — use startsWith('CONNECT') (src/db/adapter.ts:42-45)
Task 3: minor (deferred): pg_stat_xact diff undercounts when the batch DROPs/TRUNCATEs a table; comment should say so, not present Math.max(0) as a fix; disclose catalog-scan cost; track_counts=off yields silent 0
Task 3: minor (deferred): empty read results carry no column names — Grid must not assume headers on zero rows (already handled: Grid renders "0 rows")
Task 3: minor (deferred): multi-statement reads fail with the extended-protocol message "cannot insert multiple commands into a prepared statement" — confusing for a TUI user; for final review
Task 3: minor (deferred): rejection message says "any changes are already committed" even when the batch ended with rollback; wording nit
Task 3: minor (deferred): `before.inWrite` computed and unused; rejection message inaccurate when batch ended with rollback or `reset all`
Task 4: minor (deferred): visibleCols charges a trailing separator for the last column so an exactly-fitting column is dropped — check `used + widths[i] > width` (src/ui/Grid.tsx:49)
Task 4: minor (deferred): onCapture(false) only fires on keypress; if Grid unmounts or goes inactive with the popup open the parent's capture flag stays set — App should reset capture on focus change or Grid should clean up in an effect (⚠️ reachability depends on App, check in T8 review)
Task 4: minor (deferred): rowStart can leave blank lines after rows shrink — clamp to rows.length - bodyHeight
Task 4: minor (deferred): inactive-keys test only asserts doesNotMatch /carol/; add assert.match /bob/ to pin that the grid rendered
Task 5: minor (deferred): `h` under an active filter silently mutates `collapsed`; no onCapture(false) if the component unmounts/deactivates while filtering; filter matches table names only, not schema names; status line counts views as tables; untested paths: Esc exit, onLeave, ◂ marker, active=false gating
Task 5: minor (deferred): unreachable guard at Sidebar.tsx:103; cursor not reset when the filter changes (lands on last match instead of top)
Task 6: minor (deferred): stale `value` when text and a control key arrive in one stdin read (draft/Enter coalescing); untested: active=false, paste collapsing, Backspace; forward-delete acts as backspace; Ctrl-J is not Enter
Task 7: minor (deferred): Structure title lacks wrap="truncate-end" so a very long schema.name can push the idx footer out of view; layout over-allocates below height 6; StatusBar hints shrink when left text is very long (wrap right Text in <Box flexShrink={0}>)
Task 8: minor (deferred): status bar left text (81-char pending message) collides with hints at 100 cols; `commit?` still visible
Task 8: minor (deferred): setPending(null) precedes the awaited commit/rollback so handlers reactivate and q/Ctrl-C can exit mid-COMMIT; add a settling state that suspends handlers and shows "committing…" (App.tsx:189)
Task 8: minor (deferred): Structure renders without checking info.key against the current table — stale columns for a moment after switching tables (App.tsx:313); add the key comparison
Task 8: minor (deferred): loadTables nulls info but leaves showStructure true, so after r the next s needs two presses (App.tsx:129)
Task 8: minor (deferred): toggleStructure/loadTables not gated on running, so s/r during a query issue concurrent queries (App.tsx:203,125)
Task 8: minor (deferred): letter handler and confirm handler ignore key.ctrl — Ctrl-Y commits a pending write, Ctrl-Q quits; add `if (key.ctrl || key.meta) return` (App.tsx:251,225)
Task 8: minor (deferred): q while a query is running exits without cancel; call db.cancel() before exit in quit()
Task 8: minor (deferred): setCapture(false) in fail() is unconditional and can desync the Sidebar's filter mode (Tab to sidebar, f, then the running query fails); root-cause fix is a Grid unmount cleanup effect calling onCapture?.(false) and dropping the reset from fail
Task 8: minor (deferred): text after the first \r in a coalesced chunk is dropped (a\rb runs a)
Task 9: minor (deferred): README says Enter/l "expand schema" but the code toggles; s/n/p also fire from the sidebar, README lists them under grid only
Final fix wave: minor (deferred): onclose counter cannot map to the reserved connection, so a drop of the *read* connection during a pending write also refuses the commit (fails safe)
