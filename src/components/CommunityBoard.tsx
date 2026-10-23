import { useCallback, useEffect, useState, type FormEvent } from 'react'

type RecentSubmission = { mint: string; label: string; lastSubmittedAt: number; submissions: number }
type Suggestion = { id: string; kind: string; message: string; createdAt: number }
type Feed = { ready: boolean; writeEnabled: boolean; recentSubmissions: RecentSubmission[]; suggestions: Suggestion[] }
const compactMint = (mint: string) => `${mint.slice(0, 7)}…${mint.slice(-6)}`

export async function postCommunity(path: string, body: Record<string, string>) {
  const response = await fetch(`/api/v1/community/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Could not save your submission')
  return data
}

export function CommunityBoard({ onScan }: { onScan: (mint: string) => void }) {
  const [feed, setFeed] = useState<Feed | null>(null)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [category, setCategory] = useState('feature')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/community/', { cache: 'no-store' })
      if (!response.ok) { setAvailable(false); return }
      setFeed(await response.json())
      setAvailable(true)
    } catch { setAvailable(false) }
  }, [])

  useEffect(() => {
    void refresh()
    const update = () => { void refresh() }
    window.addEventListener('scarecrow:community', update)
    return () => window.removeEventListener('scarecrow:community', update)
  }, [refresh])

  async function submitSuggestion(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setFeedback('')
    try {
      await postCommunity('suggest', { kind: category, message: message.trim() })
      setMessage('')
      setFeedback('SAVED · Your suggestion is awaiting review before public display.')
    } catch (e) { setFeedback(e instanceof Error ? e.message : 'Could not submit idea') }
    finally { setSaving(false) }
  }

  return (
    <section className="panel mx-auto mt-8 max-w-6xl rounded-2xl p-5 md:p-7" aria-label="Community field board">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs tracking-[.3em] text-primary">CROW'S NEST · COMMUNITY FIELD BOARD</p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">Tokens submitted by visitors and ideas submitted for review. This feed is shared across browsers.</p>
        </div>
        <button type="button" onClick={() => void refresh()} className="rounded-full border border-primary/40 px-4 py-2 text-xs text-primary hover:box-glow">REFRESH BOARD ↻</button>
      </div>
      {(available === false || (feed && !feed.writeEnabled)) && <p className="mt-4 rounded-lg border border-accent/40 p-3 text-xs text-accent">Community posting is not configured or is temporarily unavailable. Scanning still works; posting requires database storage and a server-only signing secret.</p>}
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-3 text-xs tracking-[.2em] text-primary">RECENT TOKEN SUBMISSIONS</h3>
          {feed?.recentSubmissions?.length ? <div className="space-y-2">
            {feed.recentSubmissions.map((entry) => <button key={entry.mint} type="button" onClick={() => onScan(entry.mint)} className="flex w-full flex-col gap-1 rounded-xl border border-primary/25 bg-background/70 p-3 text-left hover:border-primary sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0 text-xs"><strong className="text-primary">{entry.label || 'Unnamed token'}</strong><span className="block break-all text-[10px] text-muted-foreground">{compactMint(entry.mint)}</span></span>
              <span className="shrink-0 text-[10px] text-accent">{entry.submissions} SUBMISSION{entry.submissions === 1 ? '' : 'S'} · SCAN ↗</span>
            </button>)}
          </div> : <p className="text-xs text-muted-foreground">No community tokens submitted yet. Scan a coin, then use “Add to Field Board.”</p>}
          <p className="mt-3 text-[10px] leading-5 text-muted-foreground">Labels are visitor-provided, unverified and do not establish ownership, legitimacy or endorsement. Recent searches are private to your browser unless you explicitly submit a mint.</p>
        </div>
        <div>
          <h3 className="mb-3 text-xs tracking-[.2em] text-primary">SUGGEST AN IMPROVEMENT</h3>
          <form onSubmit={(e) => void submitSuggestion(e)} className="space-y-3">
            <label className="block text-[11px] text-muted-foreground">Type
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 block w-full rounded-lg border border-primary/30 bg-background p-3 text-sm text-foreground">
                <option value="feature">New feature</option><option value="bug">Report an issue</option><option value="data">Data source / scanner improvement</option><option value="other">Other suggestion</option>
              </select>
            </label>
            <label className="block text-[11px] text-muted-foreground">Your idea
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} minLength={15} maxLength={500} rows={4} required placeholder="What should the SCARECROW scanner improve? (15–500 characters)" className="mt-1 block w-full rounded-lg border border-primary/30 bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground" />
            </label>
            <button type="submit" disabled={!available || !feed?.writeEnabled || saving || message.trim().length < 15} className="rounded-full border border-primary/60 bg-primary/10 px-5 py-3 text-xs font-bold text-primary disabled:opacity-40">{saving ? 'SAVING…' : 'SEND TO FIELD HQ →'}</button>
            {feedback && <p role="status" className="text-xs text-accent">{feedback}</p>}
            <p className="text-[10px] leading-5 text-muted-foreground">Anonymous suggestions are saved server-side, then reviewed before being displayed publicly. Do not submit private information.</p>
          </form>
          {!!feed?.suggestions?.length && <div className="mt-5 border-t border-primary/20 pt-4"><h4 className="mb-3 text-xs text-primary">APPROVED COMMUNITY IDEAS</h4>
            {feed.suggestions.map((item) => <p key={item.id} className="mb-2 break-words rounded-lg border border-primary/20 bg-background/70 p-3 text-xs text-muted-foreground"><span className="mr-2 text-primary">{item.kind.toUpperCase()}</span>{item.message}</p>)}
          </div>}
        </div>
      </div>
    </section>
  )
}
