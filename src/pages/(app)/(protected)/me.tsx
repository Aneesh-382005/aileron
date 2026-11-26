/* home pattern: data-forward — your venues with their links, plus the form to claim another */
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { getAuthToken, useAuth, useMutations, useQuery } from 'deepspace'
import { Copy, MapPin, Pencil, Trash2 } from 'lucide-react'
import { Button, ConfirmModal, EmptyState, Input, Label, Modal, useToast } from '@/components/ui'
import { MAX_VENUES_PER_USER, slugProblem } from '../../../game/constants'
import type { Venue } from '../../../schemas/game-schemas'

export default function MyVenues() {
  const { userId } = useAuth()
  const { records } = useQuery<Venue>('venues', { where: { ownerId: userId }, orderBy: 'createdAt', orderDir: 'desc' })
  const { putConfirmed, removeConfirmed, ready } = useMutations<Venue>('venues')
  const { success, error } = useToast()
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null)
  const problem = slug ? slugProblem(slug) : null
  const full = records.length >= MAX_VENUES_PER_USER

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await fetch('/api/actions/createVenue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getAuthToken()}` },
        body: JSON.stringify({ slug, title }),
      }).then((r) => r.json() as Promise<{ success: boolean; error?: string }>)
      if (!res.success) return error('Could not create venue', res.error)
      success('Venue created', `${location.host}/v/${slug} is yours.`)
      setSlug(''); setTitle('')
    } finally { setBusy(false) }
  }

  const act = async (fn: () => Promise<void>, done: string) => {
    try { await fn(); success(done) } catch (e) { error('Something went wrong', String((e as Error).message ?? e)) }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-14">
      <title>My venues · Aileron</title>
      <h1 className="font-display text-4xl font-bold tracking-tight">Your venues</h1>
      <p className="mt-2 max-w-xl text-muted-foreground">
        A venue is a permanent page for a recurring group. Host from it and every game lands in its hall of fame. Up to {MAX_VENUES_PER_USER} each.
      </p>

      <div className="mt-10 grid gap-3">
        {records.length ? records.map((r) => (
          <div key={r.recordId} data-testid="venue-row" className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-5">
            <div className="min-w-0 flex-1">
              <Link to={`/v/${r.data.slug}`} className="font-display text-xl font-bold hover:text-primary">{r.data.title}</Link>
              <div className="text-sm text-muted-foreground">{location.host}/v/{r.data.slug}</div>
            </div>
            <Button variant="ghost" size="icon" aria-label="Copy link"
              onClick={() => navigator.clipboard.writeText(`${location.origin}/v/${r.data.slug}`).then(() => success('Link copied'))}><Copy /></Button>
            <Button variant="ghost" size="icon" aria-label="Rename" onClick={() => setRenaming({ id: r.recordId, title: r.data.title })}><Pencil /></Button>
            <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => setDeleting({ id: r.recordId, title: r.data.title })}><Trash2 /></Button>
            <a href={`/v/${r.data.slug}/host`} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Host a game</a>
          </div>
        )) : (
          <EmptyState icon={<MapPin />} title="No venues yet" description="Claim an address for your meetup, class or office below." />
        )}
      </div>

      <form onSubmit={create} className="mt-10 rounded-xl border border-border p-6">
        <h2 className="text-lg font-semibold">New venue</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="venue-title">Name</Label>
            <Input id="venue-title" value={title} maxLength={60} placeholder="Friday Meetup" onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="venue-slug">Address</Label>
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <span>/v/</span>
              <Input id="venue-slug" value={slug} maxLength={32} placeholder="friday-meetup" aria-invalid={!!problem}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} />
            </div>
            {problem && <p className="text-sm text-destructive">{problem}</p>}
          </div>
        </div>
        <Button type="submit" className="mt-5" loading={busy} disabled={full || !slug || !title.trim() || !!problem}>
          {full ? `You have ${MAX_VENUES_PER_USER} venues` : 'Create venue'}
        </Button>
      </form>

      <Modal open={!!renaming} onClose={() => setRenaming(null)}>
        <Modal.Header><Modal.Title>Rename venue</Modal.Title></Modal.Header>
        <Modal.Body>
          <Input value={renaming?.title ?? ''} maxLength={60} aria-label="Venue name" onChange={(e) => renaming && setRenaming({ ...renaming, title: e.target.value })} />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
          <Button disabled={!ready || !renaming?.title.trim()} onClick={() => renaming && act(() => putConfirmed(renaming.id, { title: renaming.title.trim() }), 'Renamed').then(() => setRenaming(null))}>Save</Button>
        </Modal.Footer>
      </Modal>

      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} title={`Delete ${deleting?.title}?`}
        description="The page goes away and its address becomes free. Recorded games stay in the archive." confirmText="Delete"
        onConfirm={() => deleting && act(() => removeConfirmed(deleting.id), 'Venue deleted').then(() => setDeleting(null))} />
    </div>
  )
}
