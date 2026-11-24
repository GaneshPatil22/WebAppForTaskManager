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

### 2026-11-24 — Supabase project moved to Mumbai (written from the Server session)

The project is now **`rqxvzishfcthajxejvvn`**, in **ap-south-1 (Mumbai)**.
It replaces `evhhbfrlkxtlgnhnsipf` (Tokyo).

**Why:** the server is hosted on an Oracle VM in Mumbai (ap-mumbai-1).
Measured from that VM, every round trip to a Tokyo database took about 130 ms,
and API requests run several queries in sequence (plan ≈ 4, item edit ≈ 6),
so every screen would have waited 0.3–0.7 s on distance alone. Supabase can't
move a project between regions, and the old one held no real data (one test
login), so a new project was the cheap moment.

**Checked on the new project, from outside:** its JWKS serves one **ES256
(P-256)** key; email sign-in is on; anonymous sign-ins are off. That matches
the server's verifier, as before.

**Changed here:** only `.env.local` (gitignored): the URL and publishable
key. No code changes.

**To redo by hand in the new project:** Authentication → URL Configuration
(Site URL and the redirect URLs `http://localhost:5173/**` and
`http://127.0.0.1:5173/**`, plus the production address once it exists), and
the test user. Users of the old project don't carry over.

### 2026-11-24 — W2: production on the Oracle VM (written from the Server session)

The website is served at **https://brain.corelearnly.com** by the VM's shared
Caddy, from `~/n8n/site/brain` (Caddy sees it as `/srv/brain`). `/v1/*` on
that same address is forwarded to the `brain-server` container, so the
browser talks to one origin: **no CORS**, exactly like `make dev-http` with
the Vite proxy. The API also has its own address, `brain-api.corelearnly.com`,
for the mobile apps.

**Build:** `make build-prod` reads `.env.production.local` (gitignored):
`VITE_API_MODE=http`, an empty `VITE_API_BASE_URL` (same origin), and the
Mumbai project's URL and publishable key. In Vite, `.env.[mode].local` beats
`.env.local`, so `make dev` stays on the mock. Checked in the built bundle:
mode `http`, base URL empty, the new project.

**Deploy:** `SSH_KEY=… make deploy` builds, then `scripts/deploy-vm.sh` unpacks
beside the live copy and swaps it in with two renames, so a visitor never gets
a half-uploaded site. The first attempt shipped macOS `._*` metadata files and
the Mac's uid. The script now uses `COPYFILE_DISABLE=1`, `--no-xattrs`,
`--no-same-owner`, and sets root ownership.

**Supabase:** add `https://brain.corelearnly.com/**` to the redirect URLs, or
magic links can't return to the site.

### 2026-11-24 — W3: Continue with Google (written from the Server session)

Sign-in offers Google first, then the email link. `signInWithOAuth({ provider:
'google', redirectTo: window.location.origin })`, so it returns to localhost in
dev and to the site in production. Both must be in Supabase's redirect URLs.

**The server needs nothing.** A Google sign-in still yields a Supabase access
token: same ES256 key, `aud: authenticated`, not anonymous. Supabase links a
Google identity to an existing account with the same verified email
(automatic identity linking, per its docs), so data isn't split per method.

**Setup outside the code** (Supabase's "Sign in with Google" guide): a Google
Cloud OAuth client of type Web application, with redirect URI = the project's
callback (`https://rqxvzishfcthajxejvvn.supabase.co/auth/v1/callback`) and
JavaScript origins = the site and localhost. Scopes `openid`, email, profile
only. Sensitive scopes would trigger Google's slow verification.

Verified: `make ci` (52 tests, build), and a screenshot of the production
build's sign-in page with no console errors.

### 2026-11-24 — W4: the UI rebuilt for the planner (Brain 0.7.0)

The v1 interface was a stand-in for a product that has since gained a second
half: commitments, periods, reviews and the journal (`Brain/docs/15-planner.md`).
It was rebuilt from the data and the brief, not extended. **Kept:** the outbox,
`domain/time.ts`, auth, the HTTP client, the generated schema (regenerated for
the planner API), the local timer. **Replaced:** every screen, the shell, the
design tokens, the mock server's behaviour. The v1 code is in git history (W3).

**The one idea: commitments are scheduled, candidates are ranked.** Three
colours carry meaning and nothing else gets one: teal for scheduled (a
checkbox, no number), indigo for Brain's ranking (numbered, in server order),
amber and dashed for anything Brain proposes or guesses. Today puts them in
separate places: the big task, then *Ranked by Brain* on the left; *Committed*
on the right. On a phone: big task, committed, ranked, journal.

**The big task is the hinge.** Until confirmed it renders as a proposal
("Brain proposes · not confirmed"). *Choose another* lists `ranked` in server
order; any pick sends `proposedItemId` = the plan's `next` as shown and
`itemId` = the pick, so the server records a swap. *Plan tomorrow* does the
same for tomorrow (the evening ritual). The ranked list hides the big task's
row rather than showing it twice, and keeps Brain's numbers, so a gap is
visible rather than renumbered.

**Screens:** Today, Week (Mon–Sun; daily habits as one line per day), Month
(goals for the month and quarter, then dated commitments on a grid), Review
(week / month / quarter from `/v1/review`), Journal, Goals (quarter with its
month goals nested; `invalid_rollup` explained), Commitments (the five rule
shapes as a form), Inbox, All items, Settings, and /capture.

**Capture takes a dump.** A textarea, not a line. Brain makes one item per
capture, so a pasted list would become one item: when the text has several
lines, *One capture per line* is offered (on by default, off for shared
content). It splits only on line breaks the user typed and strips list
bullets; it never interprets text. The unsent draft is kept in localStorage.

**Questions and link suggestions are invisible when empty.** `/v1/questions`
is always `[]` on the server; the inbox renders a section only when there is
something in it. The real pipeline proposes only `blocks` links from phrases
like "after X", so that is all the mock proposes.

**The mock was made honest.** It no longer asks questions, suggests duplicates
or relates-links, or assigns goals to items, none of which the server does. It
gained the planner, ported from the server and Brain rather than invented:
recurrence (`mock/recurrence.ts`, a port of `Commitment.swift`), the plan's
commitments section and `committedMinutes`, occurrence rules (`not_scheduled`,
`in_future`, `invalid_move`, done-after-move counts for the original day),
92-day ranges, daily plans with swap corrections, review counts, goal periods
and rollup, journal. The seed is the brief's own commitments and no goals.
Storage key bumped to `brain-mock-db-v2`.

**The 1-3-5 board** is now a display option (Settings → Today, off by
default) for the ranked list. Nothing else reads it.

**Timezone bug fixed.** V8 lists `Asia/Calcutta`, not `Asia/Kolkata`, so the
select matched no option and showed "Africa/Abidjan". The user's zone is now
always an option (`settings/timezones.ts`, tested).

**PWA.** `manifest.webmanifest` (standalone, Capture shortcut, Android share
target to /capture) and a service worker generated at build time
(`pwa/swSource.ts`, emitted by a 20-line plugin in `vite.config.ts`, no
dependency). It precaches exactly the built files, serves the shell offline,
caches hashed assets, and never touches `/v1`. Installed and offline, the app
opens and capture works, because the outbox writes to IndexedDB first.
Verified against a production build with the network off.

**Reminders, honestly scoped.** No push server exists, so reminders are local:
the page turns the next 7 days of `/v1/occurrences` into a small digest
(a morning note per day; a heads-up the evening before a payment) and stores
it in IndexedDB. The page fires due ones while open; the service worker fires
them on Periodic Background Sync where Chrome allows it (installed app only,
the browser decides how often). Settings says exactly this. Real "rent on the
4th at 9am, app closed" needs Web Push from the server: a later step.

**Hosting note.** Browsers revalidate `/sw.js` at least daily regardless of
headers, so the current Caddy config works. Optional:
`header /sw.js Cache-Control "no-cache"` in the site block makes updates
immediate.

### 2026-11-24 — W5: questions, size guesses, error codes (Server 425785b, Brain 0.9.0)

Built on W4, which already used the full planner API. The spec's only change
since W4's generation was the Question schema (`itemId` and `createdAt` now
required). What this step adds:

**Error codes in one place.** `domain/errors.ts` maps every code the server
sends (from `Server/Sources/App`) to a sentence a person can act on;
`errorText` uses it and falls back to the server's message for a code it
doesn't know. The goal page's one-off rollup message is gone.

**Questions (S6b).** A compact, hideable "Brain has a question" card on Today
(one at a time, "+N more" links to Inbox) and the full list in Inbox. Options
are the server's, one button each, no free text. An answer leaves the list at
once and shows on the item as yours; 409 `already_answered` says to edit the
item and offers to open it; 404 just drops it. Editing an item's type also
drops its question, as the server closes it in the same edit. Hiding is
device-only and never answers anything. An item with an open question works
normally; an unknown type is never an error.

**Model guesses look like guesses (Brain 0.9.0).** Size is now a chip on every
open item row and on the big task, changed in one tap (tap, pick). A model's
size (`t1`/`t2`, median confidence about 0.39) is lighter, dashed and says
"guess"; a rule's size (`t0`, read from a duration you wrote) is marked but
without the word; yours is solid. Each change is sent as your decision, so the
server records it as a correction. The edit shows at once in the item list and
in the plan's copies; Brain's order changes only when the plan is refetched,
because the client never re-ranks. The editor's "Effort" is now "Size".

**Mock kept honest, again.** W4 believed the server made no questions and no
duplicate suggestions. With 0.9.0 it makes both, so the mock now ports them:
`typeQuestion` (prompt, all five types as options) when its rules can't read
the type, answer semantics exactly as `UserStore+Questions.swift` (204 again
for the same option, 400 `not_an_option`, 409 `already_answered`, `t3`
correction, closed by a type edit only if the new type is one of the options),
and `TitleMatcher.bestDuplicate` (plain overlap ≥ 0.7, URLs compared whole, at
most one). Known difference: the mock has no model, so it asks whenever its
rules abstain; production asks less. The seed marks sizes not stated in the
text as `t2`, as 0.9.0 would. Stored mock data migrates from v2 in place.

Not built, as asked: delta sync, dependency "pending references", the five
non-goals.

### 2026-11-24 — W5, follow-ups from Ganesh's review

- **Capture draft cleared on send.** The draft was cleared by an effect that
  never ran, because the dialog unmounted the composer first; sent text came
  back next time. Now cleared in the submit itself.
- **Select arrows** are drawn inset (12px) instead of the native one flush to
  the edge, for every `select.input`.
- **Today's gap** between the big task and the ranked list no longer changes
  with the tab: the side column spans both grid rows, so its extra height was
  split between them; the second row is now `1fr` and takes it all.
- **Add for tomorrow** (Plan tomorrow). There is no create-item endpoint, so
  each entry is an ordinary capture through the outbox; the chosen day is kept
  on the device by capture id (`local/planned.ts`) and set as the item's due
  date, as the user's decision, once Brain has made the item
  (`PlannedRunner`). Due means end of that day, 23:59:59 in the user's zone,
  which is how Brain's DateParser reads a bare day (the mock now does too).
  **Carry-over needs no code:** an open item past its day stays open, shows
  "overdue by N days" from the day it was planned for, and Brain keeps
  ranking it. The client never moves the due date itself: that would write a
  fake "user" correction every night. The dialog lists what is due tomorrow
  and what is carrying over, filtered from the server's items, not ranked.
- **Timers listed, not "+1".** Every started timer (running or paused
  part-way) gets a row with its clock, pause/resume and stop: in the sidebar
  on wide screens, as chips pinned above the bottom bar on phones. The top-bar
  button only opens the timer and shows a dot while any runs.
