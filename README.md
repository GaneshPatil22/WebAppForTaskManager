# Brain web

> **Dump anything. It organises it, finds what depends on what, and tells you
> the one thing to do next.**

The web app: a React PWA that installs on a phone, captures offline, and draws
what the server returns. It is the **only part a user ever sees**, and the part
that decides the least.

---

## The product, in one page

A person types whatever is in their head. Each dump becomes an **item** with a
type, a due date, a size and a category; dependencies are found between items;
the plan is ranked; the user confirms one big task for the day.

**The one rule:**

> **AI proposes. Deterministic code verifies and decides. The human confirms.**

In this app that rule is visual: Brain's guesses are **amber and dashed**, your
own decisions are **plain and solid**, and the big task says "Brain proposes ·
not confirmed" until you confirm it.

**Explicitly not this product** — expense tracking, subscriptions, gym/health,
social features, collaboration.

**The three repos**, built in this order:

| Repo | Role |
|---|---|
| [Brain](https://github.com/GaneshPatil22/BrainForTaskManager) | Understands a capture. Ranks the graph. No I/O. |
| [Server](https://github.com/GaneshPatil22/ServerForTaskManager) | HTTP API, Postgres, auth, background worker. |
| **Website** (this one) | React PWA. Captures offline, draws what the server returns. |

Product, architecture and ADRs live in `../Brain/docs/`. The API contract is
`../Server/Sources/API/openapi.yaml`. Web-specific decisions are in
`DECISIONS.md`.

---

## Run it

    make install    # npm ci — exact, locked versions
    make dev        # mock server in the browser: no network, no sign-in
    make ci         # typecheck + unit tests + build. What CI runs.
    make e2e        # browser smoke tests
    make help       # everything

`make dev` is the one you will use most. It loads a **complete fake server
inside the browser** — seed data, a scoring port, a toy enrichment, and
switches in Settings for "server down", "start empty" and a sample-data reset.
No Postgres, no Swift, no sign-in, no network.

To talk to the real local server:

    cp .env.example .env.local   # VITE_API_MODE=http + the two Supabase values
    make dev-http                # with `make run` going in ../Server

> **Where the mock and the server differ, the mock is wrong.** It must never
> invent behaviour the server lacks. Without that rule a mock drifts into being
> a second product.

After any change to `openapi.yaml`:

    make api         # regenerates src/api/schema.gen.ts
    make typecheck   # now tells you every call you broke

---

## The screens

| Group | Screen | Shows |
|---|---|---|
| **Plan** | Today | The big task, Brain's candidates, today's commitments |
| | Week / Month | Commitments, confirmed big tasks, what is due, journal marks |
| **Look back** | Review | The Sunday and monthly review |
| | Journal | One entry per day |
| **Decide** | Goals | Goals, including opt-in count goals (N circles) |
| | Commitments | Standing habits, rituals, payments and blocks |
| **Captured** | Inbox | Everything you dumped and what Brain made of it, plus T3 questions and suggested links |
| | Ideas | Open items typed `idea` — kept, not planned |
| | All items | Everything, filterable by status and type. **Notes live here.** |

Since Brain 0.11.0, `idea` and `note` are **not ranked**: they stay in the
graph, can still block a task, and still appear in Inbox and All items — but
they never show up in Today, because capturing a thought is not committing to
act on it. Change the type in the item sheet and it starts ranking at once.

---

## How data moves

### Out — a capture

```
CaptureComposer  ->  outbox.enqueue()  ->  IndexedDB  ->  flush with backoff
                                              ^
                                     SAFE HERE, before any network
```

`src/outbox/` is the heart of this app. A capture is written to IndexedDB
**before** it is sent, with a ULID generated here that doubles as the
idempotency key. It leaves the store only when the server answers 200 or 201.

Three different failures, three different outcomes — that distinction is the
whole value of the outbox:

| What went wrong | What happens |
|---|---|
| Network down, 500, timeout | Kept. Retry at `500ms × 2^(n-1)`, ±25% jitter, capped at 30s — the same curve as Brain's harness. |
| `401` — signed out | Kept, and the whole outbox **pauses**. Resumes on next sign-in. Nothing is dropped. |
| `400` — the server refused it as invalid | Kept, marked `rejected`, shown to you. No retry can fix a refusal, and silently deleting your words is not allowed. |

`window.addEventListener('online', ...)` ignores backoff and flushes
immediately when wifi comes back.

### Across — the request

`src/api/http.ts` is built on `openapi-fetch`, typed against
`src/api/schema.gen.ts`, which is generated from the server's own
`openapi.yaml`. **A breaking API change fails `make typecheck`, not
production.** One middleware attaches `Authorization: Bearer <token>` to every
request; supabase-js refreshes the token in the background.

`VITE_API_BASE_URL` is **empty** in both dev and production, meaning "same
origin as this page":

| | Page served by | `/v1/*` handled by | Mechanism |
|---|---|---|---|
| dev | Vite, `127.0.0.1:5173` | `127.0.0.1:8080` | `server.proxy` in `vite.config.ts` |
| prod | Caddy, `brain.corelearnly.com` | `brain-server:8080` | `reverse_proxy` |

**So there is no CORS code anywhere in this project** — no preflights, no
allowed-origin lists to keep in sync.

### Back — what the app does with it

Nothing clever, on purpose. **The client never ranks, scores or classifies.**
The order comes from `/v1/plan`. Views filter, bucket and cap the server's
list; they never compute a score. Which days a commitment falls on comes from
`/v1/occurrences`, never from the client.

TanStack Query holds the cache; `401` signs you out, `503` never does.

---

## The rules this app keeps

- **A capture is never lost.** It reaches IndexedDB before the network.
- **Commitments are scheduled; candidates are ranked.** They never read as one
  list. `/v1/plan` returns them as separate sections and Today keeps them in
  separate places, in separate colours.
- **The client never ranks, scores or classifies.**
- **"Today" is the user's today**, in the timezone from `/v1/me`.
- **Suggested looks different from "you said".** Suggested links count only
  once you confirm them. A big-task swap sends both ids so the server records
  the correction.
- **401 signs you out; 503 never does.**
- **No amounts are added up.** "22k" on a payment is text. Count goals count
  occurrences, never money.
- Device-only, never synced: the focus timer, the board's manual order,
  reminder times, the unsent capture draft.

---

## Layout

| Path | Contents |
|---|---|
| `src/api` | `BrainClient` interface, HTTP client, generated types, query hooks |
| `src/api/mock` | The in-browser fake server (scoring port, toy enrichment, seed data) |
| `src/outbox` | The never-lose-a-capture queue, for captures and comments |
| `src/domain` | Time in the user's zone, goal periods, labels, the board projection |
| `src/local` | Device-only state: timer, board order |
| `src/features` | One folder per screen (`calendar` holds Week and Month) |
| `src/pwa` | Service worker source, reminders, install |
| `src/ui` | Design tokens and primitives |
| `BasicV1UI/` | The v1 prototype (historical; the UI no longer follows it) |

---

## Production

Live at **https://brain.corelearnly.com**, served by the Oracle VM's shared
Caddy from `~/n8n/site/brain`, same origin as the API.

    SSH_KEY=/path/to/key make deploy

That runs `make build-prod` (which reads the gitignored
`.env.production.local`; in Vite `.env.[mode].local` beats `.env.local`, so
`make dev` stays on the mock), then `scripts/deploy-vm.sh` tars `dist/` over
SSH, unpacks it **beside** the live copy, and swaps it in with two renames — a
rename is atomic, so a visitor never gets a half-uploaded site.

`/assets/*` have hashed names and are cached for a year as immutable;
`index.html` is `no-cache`. The service worker is emitted from the real bundle
listing, with a version that changes whenever any precached file does.

Sign-in is Supabase: Google first, then an email magic link. Both produce the
same kind of token, so Google needed no server work at all. Every origin you
sign in from — localhost included — must be in the project's redirect URLs.
