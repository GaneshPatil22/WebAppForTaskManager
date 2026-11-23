# DECISIONS: Web

Append-only. Newest at the bottom. Product-wide decisions and ADRs live in
`../Brain/DECISIONS.md` and `../Brain/docs/adr/`; server decisions in
`../Server/DECISIONS.md`.

---

### 2026-11-24 — W0: UI and architecture, the API layer kept separate

**Scope, decided by Ganesh.** Build every screen from the v1 prototype now.
What the server doesn't model yet is still built, runs on the device, and is
labelled **In progress** wherever it shows up. The API layer stays separate
because the server is only through S4a.

**Stack, versions checked against the npm registry today and pinned exactly:**
React 19.3.1, Vite 8.3.8, TanStack Query 5.108.4, TanStack Router 1.170.46,
openapi-fetch 0.17.0 + openapi-typescript 7.13.0, supabase-js 2.119.2,
ulid 3.0.2, idb 8.0.4, Vitest 5.1.1, Playwright 1.65.1.

- **TypeScript 5.9.3, not 7.0.2.** openapi-typescript 7.13.0 declares
  `typescript: ^5.x` as a peer dependency. TS 7 would need `--force`.
- **No MSW.** msw 3 is a new major whose API I hadn't checked. A fake client
  behind the same `BrainClient` interface does the job with no extra
  dependency, and it is the same pattern as Brain's Fake/Replay adapters.
- **No Next.js.** Everything is behind sign-in, so there's no SEO to win.
  A static SPA can be hosted free, which matters under the ~₹1,000/month cap.
- **CSS Modules plus the prototype's tokens**, no Tailwind.

**The contract is generated, not copied.** `src/api/schema.gen.ts` comes
from `../Server/Sources/API/openapi.yaml` (`make api`) and is committed, so a
fresh clone builds without the Server repo. A spec change that breaks a call
fails `make typecheck`.

**The mock server ports Brain's T0 scoring** (`src/api/mock/scoring.ts`),
tested against the worked examples in `02-scoring-spec.md` (A 0.850,
B 3.248, C 1.239, ranked B > C > A). Only the mock imports it. Its toy
enrichment rules are deliberately crude; they exist so screens have
abstentions, suggestions and questions to show.

**The capture outbox.** Every capture is written to IndexedDB first, with the
client's ULID as the idempotency key (Server S3a decision 1). It leaves only
on 200/201. A 400 keeps it, marked refused, until the user discards it. A 401
pauses sending. Everything else retries: base 500 ms, doubling, ±25% jitter,
30 s cap (Brain `07-harness-spec.md`). Tested in unit tests, across a reload
over a real IndexedDB, and end to end with the mock server down.

**What is "In progress", and why each isn't on the server:**

| Feature | Backlog | Stored |
|---|---|---|
| Repeats and streaks | B-05: one moving item or a series? undecided | localStorage |
| Timers, focus log | B-02: owning execution is a product decision | localStorage |
| 1-3-5 board | B-06a | projection, plus a local manual order |
| Week planning, "Not now" | none yet; feeds B-06d daily review | localStorage |
| Progress | needs timers and repeats | localStorage |

**The 1-3-5 board buckets:** big = large/xlarge, medium = medium and unknown
(Brain scores unknown as medium), quick = tiny/small. That follows Brain's
buckets instead of the prototype's minute thresholds, which the server has no
field for. A bucket with too few items stays under-filled and says so.

**Things the server will need to answer for the web app:**
1. *Done at.* Progress uses `updatedAt` on a done item as "when it was done".
   Any later edit moves it.
2. *Ranking ideas, notes and links.* The mock ranks only tasks, reminders and
   undecided types. Whatever Brain decides, the client just shows `ranked`.
3. *Questions only exist for `type`* in the mock. The UI renders any `field`.

**Verified:** `make ci` green (52 unit tests), `make e2e` green (4 browser
tests). Mutation checks: making a refused capture retry, skipping the
persist-before-send, mapping 401 to anything else, and dropping the DST
second pass were all caught. A due-today `<=` → `<` mutant survived; it is
equivalent, because `max(0, 1 − 0/14)` is also 1. Every page was
screenshotted at 1360 px and 390 px, light and dark, with no console errors.

**Not done:** real Supabase sign-in has never run, because there is no
project yet (same as the server). http mode is covered only by unit tests of
the client against a fake `fetch`.

### 2026-11-24 — W1: the Supabase project exists

Project `evhhbfrlkxtlgnhnsipf`. Checked from outside, with no credentials:
its JWKS serves one **ES256 (P-256)** key, which is what ADR-0007 and the
server's verifier expect, and `/auth/v1/settings` shows email sign-in on and
**anonymous sign-ins off**, matching the server's refusal.

The URL and publishable key live in `.env.local` (gitignored). The key is
public by design, but it is still kept out of the repo so a rotation never
needs a commit. `make dev` stays on the mock; `make dev-http` uses Supabase.

In http mode the app loads supabase-js and shows the sign-in screen with no
console errors. **Not yet done:** a real magic-link sign-in, which needs the
redirect URLs added in the dashboard, and the server checking a real token
end to end.

The Supabase MCP in this environment belongs to a different account and
can't see this project.
