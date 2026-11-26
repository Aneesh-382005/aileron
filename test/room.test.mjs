// GameRoom protocol tests against a running `npx deepspace dev start` (AILERON_URL, default http://localhost:5173).
import test from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.AILERON_URL || "http://localhost:5173", WS = BASE.replace(/^http/, "ws");
const up = await fetch(`${BASE}/healthz`).then((r) => r.ok, () => false);
const it = (name, fn) => test(name, { skip: !up && `no dev server at ${BASE}` }, fn);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const code = () => Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)]).join("");

async function client(room) {
  const ws = new WebSocket(`${WS}/ws/game/${room}`), msgs = [];
  ws.onmessage = (e) => msgs.push(JSON.parse(e.data));
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  return { ws, msgs, send: (o) => ws.send(typeof o === "string" ? o : JSON.stringify(o)), last: (t) => msgs.findLast((m) => m.t === t) };
}
const screen = async (room = code(), host = "host-" + room) => { const s = await client(room); s.send({ t: "create", host }); await sleep(150); return s; };
const phone = async (room, name, token) => { const p = await client(room); p.send({ t: "join", name, token }); await sleep(150); return p; };
const closeAll = (...xs) => xs.forEach((x) => x.ws.close());

it("players are paired into wing crews of two", async () => {
  const s = await screen(), { code: room } = s.last("room");
  const [a, b, c] = [await phone(room, "ann", "t-a"), await phone(room, "bo", "t-b"), await phone(room, "cy", "t-c")];
  assert.deepEqual([a, b, c].map((p) => p.last("joined").crew), [1, 1, 2]);
  assert.ok(a.last("joined").color === b.last("joined").color && a.last("joined").color !== c.last("joined").color);
  assert.equal(s.last("room").colors[0], a.last("joined").color);
  assert.equal(s.last("roster").players.length, 3);
  closeAll(s, a, b, c);
});

it("a code that is in use is refused to a second host", async () => {
  const s = await screen(), other = await client(s.last("room").code);
  other.send({ t: "create", host: "someone-else" }); await sleep(150);
  assert.equal(other.last("error").code, "taken");
  closeAll(s, other);
});

it("a second screen can watch the same room but not start it", async () => {
  const host = await screen(), { code: room } = host.last("room");
  const p = await phone(room, "ann", "t-w");
  const viewer = await client(room); viewer.send({ t: "watch" }); await sleep(150);
  assert.equal(viewer.last("room").code, room);
  viewer.send({ t: "start" }); await sleep(200);
  assert.equal(host.last("snap").s, "lobby", "a viewer cannot start the game");
  host.send({ t: "start" }); await sleep(250);
  assert.equal(viewer.last("snap").s, "play", "the viewer sees the same game");
  const lost = await client(code()); lost.send({ t: "watch" }); await sleep(150);
  assert.equal(lost.last("error").msg, "no such room");
  closeAll(host, p, viewer, lost);
});

it("a lone pilot can start and is told they fly solo", async () => {
  const s = await screen(), p = await phone(s.last("room").code, "solo", "t-solo");
  s.send({ t: "start" }); await sleep(600);
  assert.equal(s.last("snap").s, "play");
  assert.equal(p.last("hud").u, 1);
  closeAll(s, p);
});

it("only the screen can start; a firing pilot scores; phones and the screen reclaim their seats", async () => {
  const s = await screen(), { code: room } = s.last("room");
  const pilot = await phone(room, "ann", "t-1"), gunner = await phone(room, "bo", "t-2");
  pilot.send({ t: "start" }); await sleep(200);
  assert.equal(s.last("snap").s, "lobby");
  s.send({ t: "start" }); await sleep(150);
  assert.equal(s.last("snap").s, "play");
  pilot.send({ t: "fire", on: 1 });
  const autopilot = setInterval(() => {
    const snap = s.last("snap"), me = snap?.sh.find((x) => x[0] === 1);
    const e = snap?.en.filter((x) => x[3] < -15).sort((a, b) => b[3] - a[3])[0];
    if (me && e) pilot.send({ t: "in", r: Math.max(-1, Math.min(1, (e[1] - me[2]) / 5)), p: Math.max(-1, Math.min(1, (e[2] - me[3]) / 4)) });
  }, 50);
  await sleep(9000);
  clearInterval(autopilot);
  assert.ok(s.last("snap").sc > 0, "kills scored");
  const hud = pilot.last("hud");
  assert.ok(hud.k > 0 && hud.w === "bo", JSON.stringify(hud));
  gunner.ws.close(); await sleep(200);
  const back = await phone(room, "bo", "t-2");
  assert.equal(back.last("joined").crew, 1);
  s.ws.close(); await sleep(200);
  const s2 = await screen(room, "host-" + room);
  assert.equal(s2.last("room").code, room);
  assert.equal(s2.last("roster").players.length, 2);
  closeAll(s2, pilot, back);
});

it("the room caps players at its limit", async () => {
  const s = await screen(), { code: room, max } = s.last("room");
  const ps = await Promise.all(Array.from({ length: max + 1 }, (_, i) => phone(room, `p${i}`, `cap-${i}`)));
  assert.equal(ps.filter((p) => p.last("error")?.msg === "room is full").length, 1);
  closeAll(s, ...ps);
});

it("garbage input never breaks the room", async () => {
  const s = await screen(), p = await phone(s.last("room").code, "<img src=x onerror=alert(1)>", "t-evil");
  assert.ok(!/[<>"&]/.test(s.last("roster").players[0].name), "markup is stripped from names");
  for (const raw of ["not json", '{"t":"in","r":"NaN","p":1e999}', '{"t":"fire"}', "{}", '{"t":"join"}', "[]", "null", "x".repeat(5000)]) p.send(raw);
  await sleep(200);
  s.send({ t: "start" }); await sleep(300);
  assert.equal(s.last("snap").s, "play");
  closeAll(s, p);
});

it("unknown room codes and bad paths are refused", async () => {
  const p = await phone(code(), "x", "t-x");
  assert.equal(p.last("error").msg, "no such room");
  assert.equal((await fetch(`${BASE}/ws/game/abcd`)).status, 404);
  assert.equal((await fetch(`${BASE}/ws/game/AIOO`)).status, 404);
  closeAll(p);
});
