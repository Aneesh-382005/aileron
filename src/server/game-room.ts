// One Durable Object per room code: the 30 Hz sim, the host screen, mirror screens and phones.
// Only finished runs are persisted. The loop stops when nobody is flying, so idle sockets hibernate.

import { BaseRoom } from 'deepspace/worker'
import type { UserAttachment } from 'deepspace/worker'
import { createGame, setFiring, setInput, snapshot, startGame, step, syncShip } from '../../shared/sim.js'
import { COLORS, MAX_PLAYERS, PHONE_GRACE_MS, SCREEN_GRACE_MS, TICK_HZ, isRoomCode, isVenueSlug } from '../game/constants'
import type { Env } from '../../worker.js'
import { appTool } from './app-tool'

interface Attachment extends UserAttachment {
  kind?: 'host' | 'viewer' | 'phone'
  hostToken?: string
  venue?: string | null
  venueTitle?: string | null
  token?: string
  pid?: number
  crew?: number
  name?: string
}

interface Player { token: string; id: number; crew: number; name: string; ws: WebSocket | null; drop: ReturnType<typeof setTimeout> | null }

interface Room {
  hostToken: string
  host: WebSocket | null
  viewers: Set<WebSocket>
  game: ReturnType<typeof createGame>
  players: Map<string, Player>
  crews: Map<number, string[]>
  nextCrew: number
  nextId: number
  n: number
  grace: ReturnType<typeof setTimeout> | null
  venue: string | null
  venueTitle: string | null
}

const STEP_MS = 1000 / TICK_HZ
const randSeed = () => (Math.random() * 2 ** 31) | 0
const axis = (v: unknown) => Math.max(-1, Math.min(1, Number(v) || 0))

export class GameRoom extends BaseRoom<Env> {
  private room: Room | null = null
  private code = ''
  private loop: ReturnType<typeof setInterval> | null = null
  private last = 0
  private behind = 0
  private gaps: number[] = []
  private rate = new WeakMap<WebSocket, { sec: number; n: number }>()

  async fetch(request: Request): Promise<Response> {
    const code = new URL(request.url).pathname.split('/').pop() ?? ''
    if (isRoomCode(code)) this.code = code
    return super.fetch(request)
  }

  protected onMessage(): void {}

  async webSocketMessage(ws: WebSocket, raw: ArrayBuffer | string): Promise<void> {
    if (typeof raw !== 'string' || raw.length > 1024) return
    const sec = Math.floor(Date.now() / 1000), r = this.rate.get(ws)
    if (!r || r.sec !== sec) this.rate.set(ws, { sec, n: 1 })
    else if (++r.n > 60) return
    let m: Record<string, unknown>
    try { m = JSON.parse(raw) } catch { return }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return
    this.wake()
    const att = (ws.deserializeAttachment() ?? {}) as Attachment
    const room = this.room

    if (m.t === 'create' && !att.kind) {
      const hostToken = String(m.host || '').slice(0, 40)
      if (!hostToken || (room && (room.host || room.hostToken !== hostToken))) return this.send(ws, { t: 'error', code: 'taken', msg: 'room code in use' })
      let r = room
      if (!r) {
        const venue = typeof m.venue === 'string' && isVenueSlug(m.venue) ? m.venue : null
        let venueTitle: string | null = null
        if (venue) {
          const got = await appTool<{ record: { data: { title: string } } }>(this.env, 'records.get', { collection: 'venues', recordId: venue }).catch(() => null)
          venueTitle = got?.data?.record.data.title ?? null
          if (!venueTitle) return this.send(ws, { t: 'error', code: 'venue', msg: 'no such venue' })
        }
        if (this.room) return this.send(ws, { t: 'error', code: 'taken', msg: 'room code in use' })
        r = this.room = this.newRoom(hostToken, venue, venueTitle)
      }
      if (r.grace) { clearTimeout(r.grace); r.grace = null }
      r.host = ws
      ws.serializeAttachment({ ...att, kind: 'host', hostToken, venue: r.venue, venueTitle: r.venueTitle })
      this.send(ws, this.roomMsg(r))
      this.syncRoom()

    } else if (m.t === 'watch' && !att.kind) {
      if (!room) return this.send(ws, { t: 'error', msg: 'no such room' })
      room.viewers.add(ws)
      ws.serializeAttachment({ ...att, kind: 'viewer' })
      this.send(ws, this.roomMsg(room))
      this.syncRoom()

    } else if (m.t === 'join' && !att.kind) {
      const token = String(m.token || '').slice(0, 40)
      if (!room || !token) return this.send(ws, { t: 'error', msg: 'no such room' })
      let p = room.players.get(token)
      if (!p) {
        if (room.players.size >= MAX_PLAYERS) return this.send(ws, { t: 'error', msg: 'room is full' })
        // wingmates: fill a crew of one, otherwise start a new crew
        let crew = [...room.crews].find(([, members]) => members.length === 1)?.[0]
        if (crew) room.crews.get(crew)!.push(token)
        else room.crews.set(crew = room.nextCrew++, [token])
        room.players.set(token, p = { token, id: room.nextId++, crew, name: 'pilot', ws: null, drop: null })
      }
      if (p.drop) { clearTimeout(p.drop); p.drop = null }
      if (p.ws && p.ws !== ws) try { p.ws.close(4000, 'replaced') } catch { /* gone */ }
      p.ws = ws
      p.name = String(m.name || '').replace(/[<>&"'`]/g, '').trim().slice(0, 12) || 'pilot'
      ws.serializeAttachment({ ...att, kind: 'phone', token, pid: p.id, crew: p.crew, name: p.name })
      this.send(ws, { t: 'joined', crew: p.crew, color: COLORS[(p.crew - 1) % COLORS.length], id: p.id })
      this.syncRoom()

    } else if (room && att.kind === 'host' && ws === room.host) {
      if (m.t === 'start' && room.game.state !== 'play' && this.live(room)) { startGame(room.game, randSeed()); this.updateLoop() }
      else if (m.t === 'stats') {
        const g = [...this.gaps].sort((a, b) => a - b), q = (f: number) => g[Math.floor(g.length * f)] ?? 0
        this.send(ws, { t: 'stats', ticks: g.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: g.at(-1) ?? 0 })
      }

    } else if (room && att.kind === 'phone' && att.token) {
      const me = room.players.get(att.token)
      if (me?.ws !== ws) return
      if (m.t === 'in') setInput(room.game, me.id, axis(m.r), axis(m.p))
      else if (m.t === 'fire') setFiring(room.game, me.id, !!m.on)
    }
  }

  protected onDisconnect(ws: WebSocket): void {
    this.wake()
    const room = this.room
    if (!room || room.viewers.delete(ws)) return
    if (ws === room.host) {
      room.host = null
      room.grace = setTimeout(() => {                             // the screen didn't come back: end the room
        for (const s of this.getWebSockets()) { this.send(s, { t: 'error', msg: 'game ended' }); try { s.close(1000, 'game ended') } catch { /* gone */ } }
        for (const p of room.players.values()) if (p.drop) clearTimeout(p.drop)
        this.room = null
        this.updateLoop()
      }, SCREEN_GRACE_MS)
      return this.updateLoop()
    }
    const me = [...room.players.values()].find((p) => p.ws === ws)
    if (!me) return
    me.ws = null
    me.drop = setTimeout(() => {                                   // seat held this long for a reconnect
      room.players.delete(me.token)
      const members = room.crews.get(me.crew)?.filter((t) => t !== me.token) ?? []
      if (members.length) room.crews.set(me.crew, members); else room.crews.delete(me.crew)
      this.syncRoom()
    }, PHONE_GRACE_MS)
    this.syncRoom()
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try { ws.close(1011, 'error') } catch { /* gone */ }
  }

  private newRoom(hostToken: string, venue: string | null, venueTitle: string | null): Room {
    return { hostToken, host: null, viewers: new Set(), game: createGame(randSeed()), players: new Map(), crews: new Map(),
      nextCrew: 1, nextId: 1, n: 0, grace: null, venue, venueTitle }
  }

  // After hibernation the sockets survive with their attachments; rebuild seats from them (the game restarts in the lobby).
  private wake(): void {
    if (this.room) return
    const atts = this.getWebSockets().map((ws) => [ws, (ws.deserializeAttachment() ?? {}) as Attachment] as const)
    const host = atts.find(([, a]) => a.kind === 'host')
    if (!host) return
    const r = this.room = this.newRoom(host[1].hostToken ?? '', host[1].venue ?? null, host[1].venueTitle ?? null)
    r.host = host[0]
    for (const [ws, a] of atts) {
      if (a.kind === 'viewer') r.viewers.add(ws)
      if (a.kind !== 'phone' || !a.token || !a.pid || !a.crew) continue
      r.players.set(a.token, { token: a.token, id: a.pid, crew: a.crew, name: a.name ?? 'pilot', ws, drop: null })
      r.crews.set(a.crew, [...(r.crews.get(a.crew) ?? []), a.token])
      r.nextId = Math.max(r.nextId, a.pid + 1); r.nextCrew = Math.max(r.nextCrew, a.crew + 1)
    }
    this.syncRoom()
  }

  private live(room: Room): number {
    let n = 0
    for (const p of room.players.values()) if (p.ws) n++
    return n
  }

  // Tick while a game is on or a phone is in the lobby; otherwise let the object sleep.
  private updateLoop(): void {
    const room = this.room
    const want = !!room && (room.game.state === 'play' ? !!room.host || this.live(room) > 0 : this.live(room) > 0)
    if (!want) {
      if (this.loop) clearInterval(this.loop)
      this.loop = null
      return
    }
    if (this.loop) return
    this.last = Date.now(); this.behind = 0
    this.loop = setInterval(() => {
      const r = this.room
      if (!r) return this.updateLoop()
      const now = Date.now()
      this.gaps.push(now - this.last); if (this.gaps.length > 900) this.gaps.shift()
      this.behind = Math.min(this.behind + now - this.last, STEP_MS * 3)   // late timers catch up, at most 3 steps
      this.last = now
      const before = r.game.state, ev: unknown[][] = []
      while (this.behind >= STEP_MS) { step(r.game); ev.push(...r.game.events); this.behind -= STEP_MS }
      if (r.game.tick === r.n) return
      const snap = { ...snapshot(r.game), ev }, prev = r.n
      r.n = r.game.tick
      const frame = JSON.stringify({ t: 'snap', ...snap })
      for (const s of [r.host, ...r.viewers]) if (s) this.send(s, frame)
      const byId = new Map([...r.players.values()].map((p) => [p.id, p]))
      for (const e of ev) if (e[0] === 'h') { const ws = byId.get(e[1] as number)?.ws; if (ws) this.send(ws, { t: 'hit' }) }
      if (Math.floor(prev / 8) !== Math.floor(r.n / 8)) {
        for (const p of r.players.values()) {
          if (!p.ws) continue
          const ship = r.game.ships.get(p.id)
          const mate = r.crews.get(p.crew)?.map((t) => r.players.get(t)).find((q) => q && q !== p)
          this.send(p.ws, { t: 'hud', s: snap.s, sc: snap.sc, h: snap.h, hm: snap.hm, k: ship?.kills ?? 0, l: ship?.linked ? 1 : 0, w: mate?.name ?? null, u: ship?.paired ? 0 : 1 })
        }
      }
      if (before !== 'play' || r.game.state !== 'over') return
      this.updateLoop()
      if (!r.game.score || r.hostToken.startsWith('load-')) return   // load tests never reach the hall of fame
      const g = r.game, names = new Map([...r.players.values()].map((p) => [p.id, p.name]))
      const pilots = [...g.ships.values()].map((s) => ({ name: names.get(s.id) ?? 'pilot', kills: s.kills })).sort((a, b) => b.kills - a.kills)
      void appTool(this.env, 'records.create', { collection: 'runs', data: {
        venueSlug: r.venue ?? '', code: this.code, teamScore: g.score, wave: g.waveIdx, playerCount: pilots.length, pilots, endedAt: new Date().toISOString(),
      } }).then((res) => {
        if (!res.success) throw new Error(res.error)
        if (r.host) this.send(r.host, { t: 'saved', venue: r.venue })
      }).catch((e) => console.error(`[GameRoom] run not saved: ${String(e)}`))
    }, STEP_MS)
  }

  private syncRoom(): void {
    const room = this.room
    if (!room) return
    const ids = new Set<number>()
    for (const p of room.players.values()) { ids.add(p.id); syncShip(room.game, p.id, p.crew, !!p.ws) }
    for (const id of [...room.game.ships.keys()]) if (!ids.has(id)) syncShip(room.game, id, null)
    const frame = JSON.stringify({ t: 'roster', players: [...room.players.values()].map((p) => ({ id: p.id, crew: p.crew, name: p.name, on: !!p.ws })) })
    for (const s of [room.host, ...room.viewers]) if (s) this.send(s, frame)
    this.updateLoop()
  }

  private roomMsg(r: Room) {
    return { t: 'room', code: this.code, colors: COLORS, venue: r.venue, venueTitle: r.venueTitle, max: MAX_PLAYERS }
  }

  private send(ws: WebSocket, msg: object | string): void {
    try { if (ws.readyState === WebSocket.OPEN) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)) } catch { /* closing */ }
  }
}
