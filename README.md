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
follows the same contract, and the same behaviour, as the real one (Brain
0.7.0 with the planner). Where they differ the mock is wrong: it must not
invent behaviour the server lacks. Settings has a "server down" switch, a
sample-data reset and "start empty".

To use the real server: copy `.env.example` to `.env.local`, set
`VITE_API_MODE=http` and the two Supabase values, run `make run` in
`../Server`, then `make dev-http`.

## The rules this app keeps

- **Commitments are scheduled; candidates are ranked.** They never read as
  one list. `/v1/plan` returns them as separate sections and Today keeps
  them in separate places, in separate colours.
- **The client never ranks, scores or classifies.** The order comes from
  `/v1/plan`. Views (like the optional 1-3-5 board) filter, bucket and cap
  the server's list, and never compute a score. Which days a commitment
  falls on comes from `/v1/occurrences`, never from the client.
- **A capture is never lost.** It goes to IndexedDB first, with a ULID made
  here as the id and idempotency key. It is sent with backoff and removed only
  after the server answers 200 or 201 (`src/outbox`).
- **"Today" is the user's today**, in the timezone from `/v1/me`.
- **Suggested looks different from "you said".** Brain's guesses and
  proposals are amber and dashed; your decisions are plain and solid.
  Suggested links count only once you confirm them. The big task says
  "Brain proposes · not confirmed" until you confirm it, and a swap sends
  both ids so the server records it.
- **401 signs you out; 503 never does.**
- **No amounts are added up.** "22k" on a payment is text.
- Device-only: the focus timer, the board's manual order, reminder times.

## Layout

| Path | Contents |
|---|---|
| `src/api` | `BrainClient` interface, HTTP client, generated types, query hooks |
| `src/api/mock` | The in-browser fake server (scoring port, toy enrichment, seed data) |
| `src/outbox` | The never-lose-a-capture queue |
| `src/domain` | Time in the user's zone, goal periods, labels, the board projection |
| `src/local` | Device-only state: timer, board order |
| `src/features` | One folder per screen (`calendar` holds Week and Month) |
| `src/pwa` | Service worker source, reminders, install |
| `src/ui` | Design tokens and primitives |
| `BasicV1UI/` | The v1 prototype (historical; the UI no longer follows it) |
