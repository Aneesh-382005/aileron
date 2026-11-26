# Aileron

A co-op flying game for meetups, classrooms and hackathon kickoffs. One big screen shows the sky, and every phone in the room becomes a plane. Tilt to steer, hold to fire, and fly close to your wingmate for double points. Players don't install anything or sign up.

**Play:** https://aileron.app.space

## Host a game

1. Open aileron.app.space on the laptop connected to the projector and click **Host a game**.
2. Everyone scans the QR code, or goes to aileron.app.space/r and types the 4-letter code.
3. Press **Start**. One player is enough. People can join or leave mid-game, and the difficulty adjusts.

On the big screen: `Enter` starts, `F` goes fullscreen, `M` toggles sound, `C` turns off screen shake.
Want a second screen? Open `/r/CODE/watch`.
On the phone: tap **Recenter** if your plane drifts. iPhones ask for motion access when you tap Join.

## Venues

A venue is a permanent page for a group that meets regularly, like `aileron.app.space/v/friday-meetup`. Sign in, go to **My venues**, and pick an address (up to 5 per person). Anyone can host a game from the venue page (`/v/friday-meetup/host`), and each game's score goes on that venue's leaderboard.

## How it works

- Each room is a Durable Object (`src/server/game-room.ts`) that runs the game 30 times a second and streams it to the screen.
- Phones connect anonymously over a WebSocket. A dropped phone keeps its seat for 20 seconds.
- The game stops ticking when nobody is playing, so an idle screen costs nothing.
- The big screen and the phone controller are plain HTML with three.js (`public/`). The landing page, venue pages and dashboard are React.
- Only two things are saved: venues, and the final score of each game. Players can't write scores; the room saves them when the game ends.
- Difficulty settings live in `TUNE` in `shared/sim.js`.

## Capacity

Tested on the live site with one screen and fake phones, each sending tilt 20 times a second:

| Phones | Updates per second | Late updates (over 50 ms) | Data to the screen |
|---|---|---|---|
| 1 | 30 | 1.5% | 10 KB/s |
| 8 | 30 | 1.4% | 36 KB/s |
| 16 | 30 | 1.8% | 66 KB/s |
| 24 | 30 | 5.4% | 97 KB/s |

The server kept a steady 30 updates a second at every size. The few late updates came from network jitter, and the screen smooths those out. Rooms are capped at 24 players.

## Develop

```sh
npx deepspace dev start    # run locally at localhost:5173
npm test                   # game and controller tests (room tests too, if the dev server is running)
npm run test:app           # browser tests, needs 2 test accounts
npm run load               # load test
```
