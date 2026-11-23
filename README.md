# Brain web

The web app for Brain: *"Dump anything. It organises it, finds what depends
on what, and tells you the one thing to do next."*

Product, architecture and ADRs live in `../Brain/docs/`. The API contract is
`../Server/Sources/API/openapi.yaml`. Web-specific decisions are in
`DECISIONS.md`.

## Run

    make install
    make dev        # mock server, no sign-in (URL printed; 5173 if free)
    make ci         # typecheck + unit tests + build: what CI runs
    make e2e        # browser smoke tests
    make help       # everything

By default the app runs against a **mock server inside the browser** that
follows the same contract as the real one, because the real server doesn't
serve the plan, links, questions or edits yet. Settings has a "server down"
switch and a data reset.

To use the real server: copy `.env.example` to `.env.local`, set
`VITE_API_MODE=http` and the two Supabase values, run `make run` in
`../Server`, then `make dev-http`. Anything the server hasn't built yet
answers 501, and the screen says so instead of breaking.

## The rules this app keeps

- **The client never ranks, scores or classifies.** The order comes from
  `/v1/plan`. Views (like the 1-3-5 board) filter, bucket and cap the
  server's list, and never compute a score.
- **A capture is never lost.** It goes to IndexedDB first, with a ULID made
  here as the id and idempotency key. It is sent with backoff and removed only
  after the server answers 200 or 201 (`src/outbox`).
- **"Today" is the user's today**, in the timezone from `/v1/me`.
- **Suggested looks different from "you said".** Dashed chips are values Brain
  decided; solid ones are yours. Suggested links count only once you confirm them.
- **401 signs you out; 503 never does.**
- **"In progress"** marks anything the server doesn't have yet (repeats,
  timers, focus history, week planning, the board grouping). Those features
  work, but only on this device.

## Layout

| Path | Contents |
|---|---|
| `src/api` | `BrainClient` interface, HTTP client, generated types, query hooks |
| `src/api/mock` | The in-browser fake server (scoring port, toy enrichment, seed data) |
| `src/outbox` | The never-lose-a-capture queue |
| `src/domain` | Time in the user's zone, labels, board projection, view registry |
| `src/local` | Device-only state for the in-progress features |
| `src/features` | One folder per screen |
| `src/ui` | Design tokens (from `BasicV1UI/`) and primitives |
| `BasicV1UI/` | The v1 prototype this design came from |
