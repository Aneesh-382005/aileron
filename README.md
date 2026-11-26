# Aileron

A co-op party game for meetups, classrooms and hackathon openers. One screen shows the sky; every phone in the room becomes a plane. Tilt to steer, hold to fire, fly close to your wingmate to link up. No app and no sign-up for players.

Live: https://aileron.app.space

## Host a game

1. Open **aileron.app.space** on the laptop driving the projector and press **Host a game** (or go straight to `/host`).
2. Players scan the QR code, or open `aileron.app.space/r` and type the 4-letter code.
3. Press **Start** (or Enter). One pilot is enough; more can join or leave mid-game and the difficulty follows the room.

Projector keys: `Enter` start, `F` fullscreen, `M` sound, `N` skip time of day, `C` calm mode (no shaking).
Extra screen: open `/r/CODE?watch` to mirror a running game.
On the phone: **Recenter** if it drifts, **Mode** switches portrait/landscape, the flip buttons invert an axis. iPhones ask for motion permission when you tap Join.

## Venues

A venue is a permanent page for a recurring group, like `aileron.app.space/v/friday-meetup`. Sign in, open **My venues** (`/me`), and claim an address (lowercase letters, numbers and hyphens, 3 to 32 characters, up to 5 per person). Anyone can press **Host a game here**; every game hosted from the venue lands in its hall of fame (this week and all time), which also shows on the host screen when the game ends.

## Architecture

1. One Cloudflare Worker (Hono) on DeepSpace; `worker.ts` wires routes and Durable Objects.
2. `GameRoom` (`src/server/game-room.ts`) extends the SDK's `BaseRoom`: one Durable Object per room code, reached at `/ws/game/:code` through the scaffold's `wsRoute` (anonymous phones get `anon-<uuid>`).
3. The 30 Hz simulation (`shared/sim.js`) runs inside the DO with a catch-up timer; the screen gets every snapshot, phones get a small HUD at ~4 Hz.
4. The loop stops when nobody is flying, so an idle projector lets the DO hibernate; seats are rebuilt from socket attachments on wake.
5. Phones keep a client-generated reconnect token: a dropped phone keeps its seat for 20 s, the host screen for 2 min.
6. The host screen and phone pad are static pages (`public/screen.html`, `public/pad.html`, three.js) served at `/host` and `/r/:code`.
7. React (generouted) pages: the static landing `/`, the venue page `/v/:slug` and the signed-in dashboard `/me`.
8. Records: `venues` (created only by the `createVenue` server action; owners rename/delete) and `runs` (written only by the GameRoom, as the app, when a game ends).
9. `/v/:slug` reads runs live with `useQuery`; the static host screen reads `/api/venues/:slug/hall`.
10. Nothing else is persisted: room state lives in DO memory.

## Capacity

Local baseline (`npm run load`, `deepspace dev` on one laptop, one screen plus N phones sending tilt at 20 Hz). These show the loop's own cost, not production latency:

| Phones | Snapshots/s | Snapshot gap p99 | DO tick p99 | Inputs/s | Screen KB/s | workerd CPU |
|---|---|---|---|---|---|---|
| 1 | 29.3 | 41 ms | 40 ms | 21 | 12 | 4% |
| 8 | 27.5 | 46 ms | 45 ms | 165 | 34 | 14% |
| 16 | 27.4 | 44 ms | 45 ms | 328 | 58 | 15% |
| 24 | 26.9 | 46 ms | 47 ms | 493 | 84 | 19% |

Rooms cap at 24 pilots (`MAX_PLAYERS` in `src/game/constants.ts`); a 25th phone is refused. The sim always advances 30 steps a second: when a timer fires late, the next frame carries two steps, which is why snapshots arrive slightly under 30/s. Real phones send input only on change plus a 1 s heartbeat, so live traffic is lower than this worst case.

## Tuning

- Difficulty: `TUNE` in `shared/sim.js` (hull, enemy count, enemy speed and wave gap per pilot connected). Unpaired pilots (solo, or the odd one out) always get the fast fire rate.
- Smoothness: the screen interpolates `delay` ms in the past, adapting between 45 and 160 ms to how unevenly snapshots arrive.

## Develop

```sh
npx deepspace dev start      # http://localhost:5173
npm test                     # sim, scaling, pad, screen; GameRoom protocol tests when dev is running
npm run test:app             # Playwright: smoke, API, venues (needs 2 test accounts)
npm run load                 # load test against the dev server
npx tsc --noEmit && npm run lint
```
