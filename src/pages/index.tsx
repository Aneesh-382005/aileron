import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Copy } from 'lucide-react'
import { Seo } from '../components/Seo'
import { seo } from '../seo'

const steps = [
  ['Put the sky on a big screen', 'Open the host screen on a projector or TV. It shows a QR code and a four-letter room code.'],
  ['Everyone scans in', 'Phones become planes in the browser. Tilt to steer, hold the button to fire.'],
  ['Find your wingmate', 'Pilots pair up. Fly close and a gold beam links you: double points, faster fire.'],
  ['Flying solo works too', 'One pilot gets fast fire all the time, and the waves ease off to match the room.'],
]

const plane = (fill: string) => (
  <g className="anim-bank">
    <rect x="-5" y="-16" width="10" height="34" rx="5" fill={fill} />
    <rect x="-30" y="-2" width="60" height="7" rx="3" fill={fill} />
    <rect x="-12" y="14" width="24" height="5" rx="2" fill={fill} />
    <circle cx="-29" cy="1.5" r="2.5" fill="var(--color-destructive)" />
    <circle cx="29" cy="1.5" r="2.5" fill="var(--color-wing-b)" />
  </g>
)

const REPO = 'https://github.com/Aneesh-382005/aileron'

const runPrompt = `Help me host the Aileron party game from this computer. The code is at ${REPO} and the README says how to run it.
Get it running here, then make it reachable from phones in the room over https, since phones only share their tilt over https. A free tunnel like cloudflared is fine.
When it's ready, give me the link to open on the big screen. Players scan the QR code on it to join.
If I need to sign in to anything, tell me what to run. Don't deploy anything or push to git.`

const sampleRuns = [
  ['3120', '24', 'Priya, Sam, Lee, Ana'],
  ['2860', '22', 'Tomás, Jo'],
  ['2410', '19', 'Kai, Mia, Rob'],
]

export default function Landing() {
  const [copied, setCopied] = useState(false)
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen bg-background text-foreground">
        <header className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-5">
          <span className="font-display text-lg font-bold tracking-[0.3em]">AILERON</span>
          <div className="flex-1" />
          <Link to="/me" className="text-sm text-muted-foreground hover:text-foreground">My venues</Link>
          <a href="/host" className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Host a game</a>
        </header>

        <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-10 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <p className="mb-4 text-sm uppercase tracking-[0.2em] text-primary">Co-op flying for any room</p>
            <h1 className="font-display text-5xl font-bold leading-[1.02] tracking-tight sm:text-7xl">
              Tilt your phone. Fly together.
            </h1>
            <p className="mt-6 max-w-md text-lg text-muted-foreground">
              One screen shows the sky. Every phone in the room becomes a plane. No app to install, and nobody needs an account, not even the host.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <a href="/host" className="rounded-full bg-primary px-6 py-3 text-base font-semibold text-primary-foreground hover:opacity-90">Host a game</a>
              <a href="/r" className="rounded-full border border-border px-6 py-3 text-base font-medium hover:bg-muted">Join with a code</a>
            </div>
            <p className="mt-5 text-sm text-muted-foreground">1 to 24 pilots per screen.</p>
          </div>
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card" aria-hidden>
          <svg viewBox="0 0 640 420" className="block w-full">
            <defs>
              <linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--color-card)" />
                <stop offset="1" stopColor="var(--color-accent)" />
              </linearGradient>
              <clipPath id="sky"><rect width="640" height="150" /></clipPath>
            </defs>
            <rect width="640" height="150" fill="url(#dusk)" />
            <circle cx="320" cy="160" r="70" fill="var(--color-primary)" opacity="0.3" clipPath="url(#sky)" />
            <circle cx="320" cy="160" r="46" fill="var(--color-primary)" opacity="0.55" clipPath="url(#sky)" />
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <line key={i} x1={320} y1={150} x2={-200 + i * 173} y2={420} stroke="var(--color-border)" strokeWidth="1.5" />
            ))}
            <line x1="0" y1="150" x2="640" y2="150" stroke="var(--color-border)" strokeWidth="2" />
            {[[-150, 0], [40, 1.1], [170, 2.1], [-60, 2.7]].map(([dx, delay]) => (
              <g key={dx} transform="translate(320 160)">
                <path d="M0 -9 L9 0 L0 9 L-9 0 Z" fill="var(--color-enemy)" className="anim-incoming"
                  style={{ ['--dx' as string]: `${dx}px`, animationDelay: `${delay}s` }} />
              </g>
            ))}
            <g className="anim-drift">
              <g transform="translate(320 320) scale(1.5) translate(-320 0)">
                {[0, 0.35].map((d) => (
                  <rect key={d} x="263" y="-40" width="3" height="16" rx="1.5" fill="var(--color-tracer)" className="anim-tracer" style={{ animationDelay: `${d}s` }} />
                ))}
                <line x1="265" y1="0" x2="375" y2="0" stroke="var(--color-primary)" strokeWidth="4" strokeLinecap="round" className="anim-beam" />
                <g transform="translate(265 0)">{plane('var(--color-wing-a)')}</g>
                <g transform="translate(375 0)">{plane('var(--color-wing-a)')}</g>
              </g>
            </g>
            <g transform="translate(560 300)">
              <g className="anim-bank">
                <rect x="-26" y="-48" width="52" height="96" rx="9" fill="var(--color-background)" stroke="var(--color-muted-foreground)" strokeWidth="2.5" />
                <rect x="-18" y="-36" width="36" height="34" rx="5" fill="var(--color-muted)" />
                <circle cx="0" cy="-19" r="7" fill="var(--color-wing-a)" />
                <rect x="-18" y="4" width="36" height="32" rx="5" fill="var(--color-wing-a)" />
              </g>
            </g>
          </svg>
          <div className="absolute left-5 top-4 font-display text-sm tracking-[0.25em] text-muted-foreground">PREVIEW</div>
          <div className="absolute right-5 top-4 flex gap-1">
            {Array.from({ length: 8 }, (_, i) => <span key={i} className={`h-2 w-4 rounded-sm ${i < 6 ? 'bg-primary' : 'bg-muted'}`} />)}
          </div>
        </div>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 lg:grid-cols-[1fr_1.4fr]">
            <h2 className="font-display text-4xl font-bold tracking-tight">Ready in the time it takes to find the HDMI cable.</h2>
            <ol className="divide-y divide-border">
              {steps.map(([title, text], i) => (
                <li key={title} className="grid grid-cols-[3.5rem_1fr] gap-4 py-5">
                  <span className="font-display text-3xl font-bold text-primary">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <h3 className="text-lg font-semibold">{title}</h3>
                    <p className="mt-1 text-muted-foreground">{text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-t border-border bg-card">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-2">
            <div>
              <h2 className="font-display text-4xl font-bold tracking-tight">Make it a weekly ritual.</h2>
              <p className="mt-4 max-w-md text-muted-foreground">
                Claim a permanent page like <span className="text-foreground">/v/friday-meetup</span>. Every game hosted there lands in its hall of fame. Venues are the one thing that needs a sign-in.
              </p>
              <Link to="/me" className="mt-8 inline-block rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground hover:opacity-90">Create a venue</Link>
            </div>
            <div className="rounded-xl border border-border bg-background p-6" aria-label="Example hall of fame">
              <div className="flex items-baseline justify-between">
                <span className="font-display text-xl font-bold">Friday Meetup</span>
                <span className="text-sm text-muted-foreground">This week</span>
              </div>
              <table className="mt-4 w-full text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr><th className="py-2 font-medium">#</th><th className="font-medium">Score</th><th className="font-medium">Wave</th><th className="font-medium">Crew</th></tr>
                </thead>
                <tbody>
                  {sampleRuns.map(([score, wave, crew], i) => (
                    <tr key={score} className="border-t border-border">
                      <td className="py-3 font-display font-bold text-primary">{i + 1}</td>
                      <td className="font-semibold">{score}</td>
                      <td>{wave}</td>
                      <td className="text-muted-foreground">{crew}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto grid max-w-6xl items-start gap-12 px-6 py-20 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <h2 className="font-display text-4xl font-bold tracking-tight">Run it on your own computer.</h2>
              <p className="mt-4 max-w-md text-muted-foreground">
                Paste this into Claude Code, Codex or Cursor. Your agent sets up a private copy you host from your laptop.
              </p>
              <a href={REPO} className="mt-6 inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Source on GitHub</a>
            </div>
            <div className="relative rounded-xl border border-border bg-card">
              <button
                onClick={() => navigator.clipboard.writeText(runPrompt).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })}
                className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied' : 'Copy prompt'}
              </button>
              <pre className="overflow-x-auto whitespace-pre-wrap p-6 pt-14 font-mono text-sm leading-relaxed text-muted-foreground">{runPrompt}</pre>
            </div>
          </div>
        </section>

        <footer className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-8 text-sm text-muted-foreground">
          <span className="font-display font-bold tracking-[0.3em] text-foreground">AILERON</span>
          <span>Built on DeepSpace</span>
          <div className="flex-1" />
          <a href="/host" className="hover:text-foreground">Host</a>
          <a href="/r" className="hover:text-foreground">Join</a>
          <Link to="/me" className="hover:text-foreground">Venues</Link>
          <a href={REPO} className="hover:text-foreground">GitHub</a>
        </footer>
      </div>
    </>
  )
}
