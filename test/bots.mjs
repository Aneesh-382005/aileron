import { mulberry32 } from "../shared/rng.js";
import { createGame, startGame, syncShip, setInput, setFiring, step } from "../shared/sim.js";

// Plays a game with n imperfect autopilots: they re-aim every few ticks, aim a little off, and dodge late.
export function playBots(n, seed, { maxSeconds = 600, joinAt = [], leaveAt = [] } = {}) {
  const g = createGame(seed), rnd = mulberry32(seed ^ 0x5bd1e995), crewOf = (id) => Math.ceil(id / 2);
  for (let id = 1; id <= n; id++) syncShip(g, id, crewOf(id), true);
  startGame(g, seed);
  const aim = new Map(), firstHit = { wave: null };
  let tick = 0;
  while (g.state === "play" && tick < maxSeconds * 30) {
    tick++;
    for (const [t, id] of joinAt) if (t * 30 === tick) syncShip(g, id, crewOf(id), true);
    for (const [t, id] of leaveAt) if (t * 30 === tick) syncShip(g, id, null);
    for (const s of g.ships.values()) {
      if (!s.on) continue;
      setFiring(g, s.id, true);
      if (tick % 9 !== s.id % 9) continue;                          // reaction time ~300 ms
      const threat = g.enemies.find((e) => e.z > -45 && Math.abs(e.x - s.x) < 4.5 && Math.abs(e.y - s.y) < 3.5);
      const target = g.enemies.filter((e) => e.z < -25).sort((a, b) => b.z - a.z)[0];
      let ax = s.x, ay = s.y;
      if (threat && rnd() < 0.6) { ax = s.x + (s.x > threat.x ? 8 : -8); ay = s.y + (s.y > threat.y ? 3 : -3); }
      else if (target) { ax = target.x + (rnd() - 0.5) * 4; ay = target.y + (rnd() - 0.5) * 3; }
      aim.set(s.id, [Math.max(-1, Math.min(1, (ax - s.x) / 5)), Math.max(-1, Math.min(1, (ay - s.y) / 4))]);
    }
    for (const [id, [r, p]] of aim) setInput(g, id, r, p);
    step(g);
    if (firstHit.wave == null && g.events.some((e) => e[0] === "h")) firstHit.wave = g.waveIdx;
  }
  return { g, wave: g.waveIdx, seconds: tick / 30, firstHitWave: firstHit.wave, over: g.state === "over" };
}
