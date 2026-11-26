import test from "node:test";
import assert from "node:assert/strict";
import { createGame, startGame, syncShip, setFiring, step, HULL_MAX, TUNE } from "../shared/sim.js";
import { playBots } from "./bots.mjs";

for (const n of [1, 2, 3, 8]) {
  test(`${n} pilot${n > 1 ? "s" : ""}: waves are survivable but the game ends`, () => {
    for (const seed of [11, 22, 33]) {
      const r = playBots(n, seed);
      assert.ok(r.wave >= 12, `seed ${seed} died on wave ${r.wave}`);
      assert.ok(r.over, `seed ${seed} still alive after ${r.seconds}s on wave ${r.wave}`);
      assert.ok(r.firstHitWave != null && r.firstHitWave <= 16, `seed ${seed} untouched until wave ${r.firstHitWave}`);
    }
  });
}

test("more pilots get more hull, more enemies and faster enemies", () => {
  const waveAt = (n) => {
    const g = createGame(5);
    for (let id = 1; id <= n; id++) syncShip(g, id, Math.ceil(id / 2), true);
    startGame(g, 5);
    for (const s of g.ships.values()) s.inv = 1e9;
    while (g.waveIdx < 1) step(g);                                   // wave 1 is always a scatter of `count` enemies
    return { hull: g.hullMax, queued: g.queue.length + g.enemies.length, speed: g.speed };
  };
  const [one, eight] = [waveAt(1), waveAt(8)];
  assert.equal(one.hull, HULL_MAX);
  assert.ok(eight.hull > one.hull && eight.hull <= TUNE.hullCap);
  assert.ok(eight.queued > one.queued);
  assert.ok(eight.speed > one.speed);
});

test("pilots joining and leaving mid-game adjust the hull without resetting the run", () => {
  const r = playBots(2, 7, { maxSeconds: 60, joinAt: [[10, 3], [10, 4], [12, 5]], leaveAt: [[30, 3], [30, 4], [30, 5], [31, 2]] });
  assert.equal(r.g.hullMax, HULL_MAX, "back to solo hull");
  assert.ok(r.g.hull >= 1 && r.g.waveIdx >= 3 && r.g.score > 0);
  const g = createGame(1);
  for (let id = 1; id <= 8; id++) syncShip(g, id, Math.ceil(id / 2), true);
  startGame(g); g.hull = 1;
  for (let id = 2; id <= 8; id++) syncShip(g, id, null);
  step(g);
  assert.equal(g.state, "play", "shrinking the hull never ends the game");
  assert.equal(g.hull, 1);
});

test("an unpaired pilot (solo or odd one out) always has the fast fire rate", () => {
  const shots = (crews) => {
    const g = createGame(1);
    crews.forEach((c, i) => syncShip(g, i + 1, c, true));
    for (const s of g.ships.values()) s.x = s.id * 20 - 30;          // far apart: nobody is linked
    setFiring(g, 1, true);
    let n = 0;
    for (let i = 0; i < 90; i++) { step(g); n += g.events.filter((e) => e[0] === "f" && e[1] === 1).length; }
    return n;
  };
  assert.ok(shots([1]) > shots([1, 1]), "solo fires faster than an unlinked wingmate");
  assert.equal(shots([1, 1, 2]), shots([1, 1]), "pilot 1 is paired either way");
  assert.equal(shots([2, 1, 1]), shots([1]), "the odd one out gets the solo rate");
});
