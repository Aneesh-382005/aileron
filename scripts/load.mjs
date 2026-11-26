#!/usr/bin/env node
// Load test: one host screen plus N fake phones against a GameRoom.
//   node scripts/load.mjs http://localhost:5173 1,8,16,24 30
// Phones send tilt at 20 Hz (worst case) and toggle fire. Against a deployed URL the snapshot gaps include real
// network jitter; workerd CPU is only read for localhost.
import { readdirSync, readFileSync } from 'node:fs'

const base = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '')
const counts = (process.argv[3] || '1,8,16,24').split(',').map(Number)
const secs = Number(process.argv[4] || 30)
const wsBase = base.replace(/^http/, 'ws')
const local = /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base)
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const code = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * 24)]).join('')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pct = (arr, f) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * f))] : 0 }

function workerdCpu() {
  let t = 0
  for (const pid of readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      if (!readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('workerd')) continue
      const f = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')
      t += (Number(f[11]) + Number(f[12])) / 100
    } catch { /* process went away */ }
  }
  return t
}

function open(url) {
  const ws = new WebSocket(url)
  return new Promise((resolve, reject) => { ws.onopen = () => resolve(ws); ws.onerror = reject })
}

async function run(n) {
  let room = code(), screen
  const c0 = performance.now()
  for (;;) {                                            // pick a free code, like the host page does
    screen = await open(`${wsBase}/ws/game/${room}`)
    const reply = new Promise((r) => { screen.onmessage = (e) => r(JSON.parse(e.data)) })
    screen.send(JSON.stringify({ t: 'create', host: 'load-' + Math.random().toString(36).slice(2) }))
    const m = await reply
    if (m.t === 'room') break
    screen.close(); room = code()
  }
  const connectMs = performance.now() - c0
  const snaps = [], screenBytes = { n: 0 }, restarts = { n: 0 }
  let lastState = 'lobby', maxShips = 0, maxBullets = 0
  screen.onmessage = (e) => {
    screenBytes.n += e.data.length
    const m = JSON.parse(e.data)
    if (m.t === 'snap') {
      snaps.push(performance.now())
      maxShips = Math.max(maxShips, m.sh.length); maxBullets = Math.max(maxBullets, m.bu.length)
      if (m.s === 'over' && lastState === 'play') { restarts.n++; screen.send('{"t":"start"}') }
      lastState = m.s
    }
  }

  const phones = await Promise.all(Array.from({ length: n }, async (_, i) => {
    const ws = await open(`${wsBase}/ws/game/${room}`)
    const p = { ws, hud: 0, sent: 0, joined: false, fire: false, r: 0, pp: 0 }
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'hud') p.hud++; if (m.t === 'joined') p.joined = true }
    ws.send(JSON.stringify({ t: 'join', name: `bot${i + 1}`, token: `load-${room}-${i}` }))
    return p
  }))
  await sleep(300)
  const joined = phones.filter((p) => p.joined).length
  screen.send('{"t":"start"}')

  const timers = phones.map((p, i) => setInterval(() => {
    p.r = Math.max(-1, Math.min(1, p.r + (Math.random() - 0.5) * 0.3))
    p.pp = Math.max(-1, Math.min(1, p.pp + (Math.random() - 0.5) * 0.3))
    p.ws.send(`{"t":"in","r":${p.r.toFixed(3)},"p":${p.pp.toFixed(3)}}`); p.sent++
    if (Math.random() < 0.05) { p.fire = !p.fire; p.ws.send(`{"t":"fire","on":${p.fire ? 1 : 0}}`); p.sent++ }
  }, 50 + (i % 5)))

  await sleep(1000)                                     // warm-up, then measure
  snaps.length = 0; screenBytes.n = 0; for (const p of phones) { p.hud = 0; p.sent = 0 }
  const cpu0 = local ? workerdCpu() : 0, t0 = performance.now()
  await sleep(secs * 1000)
  const elapsed = (performance.now() - t0) / 1000, cpu = local ? workerdCpu() - cpu0 : 0
  timers.forEach(clearInterval)

  const gaps = snaps.slice(1).map((t, i) => t - snaps[i])
  const result = {
    n, joined, secs: +elapsed.toFixed(1),
    snapHz: +(snaps.length / elapsed).toFixed(1),
    gapP50: +pct(gaps, 0.5).toFixed(1), gapP95: +pct(gaps, 0.95).toFixed(1), gapP99: +pct(gaps, 0.99).toFixed(1), gapMax: +Math.max(0, ...gaps).toFixed(1),
    over50ms: gaps.filter((g) => g > 50).length,
    inMsgPerSec: Math.round(phones.reduce((s, p) => s + p.sent, 0) / elapsed),
    outMsgPerSec: Math.round((snaps.length + phones.reduce((s, p) => s + p.hud, 0)) / elapsed),
    screenKBps: +(screenBytes.n / 1024 / elapsed).toFixed(1),
    maxShips, maxBullets, restarts: restarts.n,
    workerdCpuPct: local ? +((cpu / elapsed) * 100).toFixed(1) : 'n/a',
    connectMs: Math.round(connectMs),
  }
  for (const p of phones) p.ws.close()
  screen.close()
  await sleep(500)
  return result
}

const rows = []
for (const n of counts) { const r = await run(n); rows.push(r); console.log(JSON.stringify(r)) }
console.table(rows)
