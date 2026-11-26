import { useParams } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { Plane, Trophy } from 'lucide-react'
import { EmptyState, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui'
import type { Run, Venue } from '../../../schemas/game-schemas'

const WEEK_MS = 7 * 864e5

export default function VenuePage() {
  const slug = useParams().slug ?? ''
  const { records: venues, status } = useQuery<Venue>('venues', { where: { slug } })
  const { records: runs } = useQuery<Run>('runs', { where: { venueSlug: slug }, orderBy: 'teamScore', orderDir: 'desc', limit: 100 })
  const venue = venues[0]?.data
  const all = runs.map((r) => r.data)
  const weekAgo = Date.now() - WEEK_MS
  const boards = { week: all.filter((r) => Date.parse(r.endedAt) >= weekAgo).slice(0, 10), all: all.slice(0, 10) }

  if (status === 'loading') return <div className="mx-auto max-w-4xl px-6 py-16"><div className="h-12 w-72 animate-pulse rounded-lg bg-muted" /></div>
  if (!venue) {
    return (
      <EmptyState icon={<Plane />} title="No venue here" description={`Nobody has claimed /v/${slug} yet.`}
        action={{ label: 'Claim it', onClick: () => { location.href = '/me' } }} />
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-14">
      <title>{`${venue.title} · Aileron`}</title>
      <p className="text-sm uppercase tracking-[0.2em] text-primary">Venue</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-6">
        <h1 className="font-display text-5xl font-bold tracking-tight">{venue.title}</h1>
        <a href={`/host?venue=${slug}`} className="rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground hover:opacity-90">
          Host a game here
        </a>
      </div>
      <p className="mt-3 text-muted-foreground">Every game hosted from this page is ranked below. Scores update live.</p>

      <Tabs defaultValue="week" className="mt-10">
        <TabsList>
          <TabsTrigger value="week">This week</TabsTrigger>
          <TabsTrigger value="all">All time</TabsTrigger>
        </TabsList>
        {(['week', 'all'] as const).map((key) => (
          <TabsContent key={key} value={key}>
            {boards[key].length ? (
              <table className="mt-4 w-full text-left">
                <thead className="text-sm text-muted-foreground">
                  <tr><th className="py-2 font-medium">#</th><th className="font-medium">Team score</th><th className="font-medium">Wave</th><th className="font-medium">Crew</th><th className="hidden font-medium sm:table-cell">Played</th></tr>
                </thead>
                <tbody>
                  {boards[key].map((r, i) => (
                    <tr key={`${r.code}-${r.endedAt}`} className="border-t border-border align-top">
                      <td className="py-3 font-display text-lg font-bold text-primary">{i + 1}</td>
                      <td className="py-3 text-lg font-semibold">{r.teamScore}</td>
                      <td className="py-3">{r.wave}</td>
                      <td className="py-3 text-muted-foreground">
                        {r.pilots.map((p, j) => <span key={j} className={j === 0 ? 'text-foreground' : ''}>{j ? ', ' : ''}{p.name} {p.kills}</span>)}
                      </td>
                      <td className="hidden py-3 text-sm text-muted-foreground sm:table-cell">{new Date(r.endedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState icon={<Trophy />} title={key === 'week' ? 'No games this week' : 'No games yet'}
                description="Host a game here and the crew's score lands on this board when the hull runs out." />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
