import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import scarecrow from '@/assets/scarecrow.jpg'
import { CommunityBoard, postCommunity } from '@/components/CommunityBoard'

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: 'SCARECROW // Solana Signal Scanner' },
      { name: 'description', content: 'Scarecrow V4: holder-aware, age-aware, confidence-labeled, evidence-based Solana token grades using available on-chain and DEX data.' },
      { property: 'og:title', content: 'SCARECROW // Solana Signal Scanner' },
      { property: 'og:description', content: 'Feed it a mint. It watches the field. Now with evidence-based provisional grades and confidence labels.' },
    ],
  }),
  component: Index,
})

type Indicator = { id: string; title: string; severity: 'information' | 'attention' | 'elevated'; description: string; source: string; evidenceUrl?: string }
type Similar = { mint: string; name: string | null; symbol: string | null; match: string; liquidityUsd: number | null; volume24hUsd: number | null; marketCap: number | null; fdv: number | null; verdict?: { label: string; reasons: string[] }; sourceUrl: string }
type ScanResponse = {
  mint: string
  checkedAt: string
  onchain: { exists: boolean | null; verified: boolean; reason?: string; program?: string; mintAuthority?: string | null; freezeAuthority?: string | null; decimals?: number; extensions?: { type: string }[] }
  market: { name: string | null; symbol: string | null; poolCount: number; similar: Similar[]; duplicateCaveat: string; primaryPool: null | { dex: string; liquidityUsd: number | null; volume24hUsd: number | null; volume6hUsd?: number | null; volume1hUsd?: number | null; marketCap?: number | null; fdv?: number | null; pairCreatedAt?: number | null; url: string } }
  concentration: null | { top10TokenAccountsPct: number; caveat: string }
  holders: { holders: number | null; source: string | null; marketCapUsed: number | null; marketCapPerHolder: number | null; holdersPer100kCap: number | null; holderTop20Pct: number | null; holderTop1Pct: number | null; holderTop10Pct: number | null; caveat: string }
  age: { createdAt: number | null; ageDays: number | null; ageSource: string | null; firstTradingAt: number | null; tradingDays: number | null; tradingAgeSource: string | null; caveat: string }
  locks: { status: 'verified' | 'not_verified'; lockedAmount: number | null; lockedPct: number | null; unlockAt: number | null; contracts: string[]; source: string | null }

  coverage: Record<string, boolean>
  assessment: { level: string; signals: Indicator[]; disclaimer: string }
  grade: { grade: string; score: number | null; stance: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'; coverageScore: number; basis: string; reasons: string[]; unavailable: string[]; formula: string; partial: boolean }
  sourceLinks: string[]
}
type Candidate = { mint: string; name: string; symbol: string; volume24hUsd: number | null; liquidityUsd: number | null; marketCap: number | null }
type Recent = { mint: string; title: string }

const STEPS = [
  'Planting sensors in the field…',
  'Reading live Solana mint controls…',
  'Interrogating indexed DEX pairs…',
  'Checking holders, age and token locks…',
  'Cross-checking similar-name listings…',
  'Calculating the provisional grade…',
]
const RECENT_KEY = 'scarecrow_lovable_recent_mints_v1'
const VOTE_KEY = 'scarecrow_lovable_my_reactions_v1'
const CROW_MINT = 'GtV6g1ey2NERrcbvL5bdzrxRJQDfxpMaLU9oLtRipump'
const SOL_MINT = 'So11111111111111111111111111111111111111112'
const isAddressShape = (value: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)
const compact = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? 'UNAVAILABLE' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)
const days = (value: number | null | undefined) => value == null ? 'UNAVAILABLE' : `${new Intl.NumberFormat('en-US').format(value)} DAYS`
const when = (value: number | null | undefined) => value == null ? 'UNKNOWN' : new Date(value).toLocaleDateString()
const money = (n: number | null | undefined) => typeof n === 'number' && Number.isFinite(n) ? `$${new Intl.NumberFormat('en-US', { notation: Math.abs(n) >= 1000000 ? 'compact' : 'standard', maximumFractionDigits: Math.abs(n) >= 10000 ? 0 : 2 }).format(n)}` : 'UNAVAILABLE'
const short = (mint: string) => `${mint.slice(0, 7)}…${mint.slice(-6)}`
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function Index() {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [step, setStep] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<ScanResponse | null>(null)
  const [matches, setMatches] = useState<Candidate[]>([])
  const [recent, setRecent] = useState<Recent[]>([])
  const active = useRef(false)

  useEffect(() => {
    try { setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') as Recent[]) } catch { /* storage may be blocked */ }
  }, [])

  function remember(mint: string, title: string) {
    setRecent((old) => {
      const entries = [{ mint, title }, ...old.filter((x) => x.mint !== mint)].slice(0, 6)
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(entries)) } catch { /* optional convenience only */ }
      return entries
    })
  }

  async function scanMint(mint: string) {
    if (active.current) return
    active.current = true
    setLoading(true)
    setError('')
    setReport(null)
    setMatches([])
    setStep(0)
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 570)
    try {
      const [response] = await Promise.all([
        fetch(`/api/v1/scan?mint=${encodeURIComponent(mint)}`, { headers: { accept: 'application/json' } }),
        wait(2400),
      ])
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to complete the scan')
      const result = data as ScanResponse
      setStep(STEPS.length)
      await wait(350)
      setReport(result)
      remember(result.mint, result.market?.symbol ? `$${result.market.symbol} · ${short(result.mint)}` : short(result.mint))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to complete scan')
    } finally {
      clearInterval(timer)
      setStep(-1)
      setLoading(false)
      active.current = false
    }
  }

  async function go(e: FormEvent) {
    e.preventDefault()
    if (active.current) return
    const query = input.trim()
    setError('')
    setMatches([])
    if (!query) return setError('PASTE A TOKEN MINT, NAME, OR TICKER')
    if (isAddressShape(query)) return void scanMint(query)
    if (query.length < 2 || query.length > 60) return setError('ENTER A SOLANA MINT OR A NAME/TICKER OF 2–60 CHARACTERS')
    setLoading(true)
    try {
      const response = await fetch(`/api/v1/search?q=${encodeURIComponent(query)}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Token lookup unavailable')
      if (!data.results?.length) throw new Error('No indexed token matches found. Paste the exact mint if you have it.')
      setMatches(data.results as Candidate[])
      setReport(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search unavailable')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="scanlines relative min-h-screen overflow-hidden">
      <img src={scarecrow} alt="" className="pointer-events-none fixed inset-0 h-full w-full object-cover opacity-30" />
      <div className="grid-bg pointer-events-none fixed inset-0 opacity-30" />
      <div className="animate-sweep pointer-events-none fixed inset-x-0 top-0 h-32 bg-gradient-to-b from-transparent via-primary/10 to-transparent" />

      <main className="relative z-10 mx-auto max-w-6xl px-4 py-12">
        <header className="mb-10 text-center">
          <p className="text-xs tracking-[0.5em] text-accent glow-orange">// FIELD WATCH PROTOCOL v4.0 · SOLANA MAINNET</p>
          <div className="mt-3 flex items-center justify-center gap-3 sm:gap-5"><img src="/wheat-emblem.png" alt="SCARECROW wheat emblem" className="h-12 w-12 shrink-0 object-contain sm:h-16 sm:w-16" /><h1 className="animate-flicker font-display text-3xl font-black tracking-widest text-primary glow sm:text-5xl md:text-7xl">SCARECROW</h1></div>
          <p className="mt-3 text-sm text-muted-foreground">Feed it a coin. It watches the field. It grades the infrastructure.</p>
          <p className="mx-auto mt-2 max-w-2xl text-xs text-muted-foreground">Read-only screening · Live on-chain mint facts + indexed DEX data · No wallet required</p>
        </header>

        <form onSubmit={go} className="panel mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl p-3 md:flex-row">
          <input aria-label="Solana coin mint address, name, or ticker" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Paste Solana coin address — or enter name / ticker"
            className="min-w-0 flex-1 rounded-full bg-transparent px-4 py-3 text-primary outline-none placeholder:text-muted-foreground" />
          <button disabled={loading} className="rounded-full bg-primary px-8 py-3 font-display font-bold tracking-widest text-primary-foreground transition hover:box-glow hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50">
            {loading ? 'PROCESSING' : 'SCAN'}
          </button>
        </form>
        {error && <p role="alert" className="mx-auto mt-3 max-w-3xl text-center text-xs text-destructive">{error}</p>}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
          <button onClick={() => { setInput(CROW_MINT); void scanMint(CROW_MINT) }} disabled={loading} className="underline transition hover:text-primary">try $CROW</button>
          <button onClick={() => { setInput(SOL_MINT); void scanMint(SOL_MINT) }} disabled={loading} className="underline transition hover:text-primary">try wrapped SOL</button>
        </div>

        {recent.length > 0 && (
          <div className="mx-auto mt-5 max-w-3xl text-center">
            <p className="mb-2 text-[10px] tracking-[.25em] text-muted-foreground">RECENT PASTES · THIS BROWSER</p>
            <div className="flex flex-wrap justify-center gap-2">
              {recent.map((item) => <button key={item.mint} disabled={loading} onClick={() => { setInput(item.mint); void scanMint(item.mint) }} className="rounded-full border border-primary/30 bg-background/70 px-3 py-2 text-xs text-primary transition hover:border-primary hover:box-glow">{item.title}</button>)}
            </div>
          </div>
        )}

        <CommunityBoard onScan={(mint) => { setInput(mint); void scanMint(mint) }} />

        {matches.length > 0 && (
          <section className="panel mx-auto mt-8 max-w-3xl rounded-2xl p-5">
            <p className="font-display text-sm tracking-widest text-primary">CHOOSE A TOKEN TO SCAN</p>
            <p className="mb-4 mt-2 text-xs leading-6 text-muted-foreground">Matches are sorted by indexed 24H trading volume. The most-traded result is NOT necessarily the original or official token. Check the mint carefully.</p>
            <div className="space-y-2">
              {matches.map((item) => <button key={item.mint} disabled={loading} onClick={() => { setInput(item.mint); void scanMint(item.mint) }} className="flex w-full min-w-0 flex-col gap-2 rounded-xl border border-primary/25 bg-background/80 p-3 text-left transition hover:border-primary hover:box-glow sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0"><strong className="text-sm text-primary">{item.name} · {item.symbol}</strong><span className="mt-1 block break-all text-[10px] text-muted-foreground">{item.mint}</span></span>
                <span className="shrink-0 text-xs text-accent">VOL {money(item.volume24hUsd)}</span>
              </button>)}
            </div>
          </section>
        )}

        {step >= 0 && (
          <div className="panel mx-auto mt-10 max-w-xl rounded-2xl p-6" role="status" aria-live="polite">
            <div className="mx-auto mb-6 h-24 w-24 animate-spin-slow rounded-full border-2 border-dashed border-primary box-glow" />
            {STEPS.map((s, i) => (
              <p key={s} className={`py-1 text-sm ${i < step ? 'text-primary' : i === step ? 'text-accent glow-orange' : 'text-muted-foreground/40'}`}>
                {i < step ? '[✓]' : i === step ? '[»]' : '[ ]'} {s}
              </p>
            ))}
            {step === STEPS.length && <p className="mt-4 text-center font-display text-primary">FINISHED SCAN ✓</p>}
          </div>
        )}

        {report && <Dashboard r={report} />}
      </main>
    </div>
  )
}

function getPreviousBrowserVote(mint: string): string | null {
  try {
    const record = JSON.parse(localStorage.getItem(VOTE_KEY) || '{}') as Record<string, string>
    return record[mint] === 'legit' || record[mint] === 'concern' ? record[mint] : null
  } catch { return null }
}

type CommunityVotes = { legit: number; concern: number; total: number; myVote: 'legit' | 'concern' | null }

function Reactions({ mint, tokenLabel }: { mint: string; tokenLabel: string }) {
  const [votes, setVotes] = useState<CommunityVotes | null>(null)
  const [available, setAvailable] = useState(true)
  const [writeEnabled, setWriteEnabled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [submission, setSubmission] = useState('')
  const [previous, setPrevious] = useState<string | null>(null)

  useEffect(() => { setPrevious(getPreviousBrowserVote(mint)) }, [mint])
  useEffect(() => {
    let open = true
    setVotes(null)
    setWriteEnabled(null)
    setFeedback('')
    fetch(`/api/v1/community/?mint=${encodeURIComponent(mint)}`, { cache: 'no-store' })
      .then(async (response) => { if (!response.ok) throw new Error('offline'); return response.json() })
      .then((data) => { if (open) { setVotes(data.votes as CommunityVotes); setAvailable(true); setWriteEnabled(!!data.writeEnabled) } })
      .catch(() => { if (open) setAvailable(false) })
    return () => { open = false }
  }, [mint])

  async function refreshVotes() {
    const response = await fetch(`/api/v1/community/?mint=${encodeURIComponent(mint)}`, { cache: 'no-store' })
    if (response.ok) { const data = await response.json(); setVotes(data.votes as CommunityVotes); setAvailable(true); setWriteEnabled(!!data.writeEnabled) }
  }

  async function vote(choice: 'legit' | 'concern') {
    if (busy || votes?.myVote || !available || !writeEnabled) return
    setBusy(true); setFeedback('')
    try {
      const result = await postCommunity('vote', { mint, choice })
      setFeedback(result.recorded ? 'Reaction saved to the community database.' : 'Your browser already reacted to this token.')
      try { await refreshVotes() } catch { setFeedback('Saved. Refresh to see the latest total.') }
    } catch (e) { setFeedback(e instanceof Error ? e.message : 'Could not save reaction') }
    finally { setBusy(false) }
  }

  async function submit() {
    if (busy || !available || !writeEnabled) return
    setBusy(true); setSubmission('')
    try {
      const result = await postCommunity('submit', { mint, label: tokenLabel })
      setSubmission(result.recorded ? 'Token added to the shared Field Board.' : 'This browser already submitted this token.')
      window.dispatchEvent(new Event('scarecrow:community'))
    } catch (e) { setSubmission(e instanceof Error ? e.message : 'Could not submit token') }
    finally { setBusy(false) }
  }

  return (
    <div className="panel animate-rise mt-4 rounded-2xl p-5 md:col-span-3">
      <p className="mb-3 text-xs tracking-widest text-muted-foreground">CITIZEN SIGNAL · SHARED COMMUNITY REACTIONS</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void vote('legit')} disabled={busy || !available || !writeEnabled || !!votes?.myVote || !votes} className={`rounded-full border px-5 py-3 text-xs font-bold transition hover:box-glow disabled:opacity-60 ${votes?.myVote === 'legit' ? 'border-primary bg-primary/15 text-primary' : 'border-primary/40 text-foreground'}`}>👍 LEGIT · {votes?.legit ?? '–'}</button>
        <button type="button" onClick={() => void vote('concern')} disabled={busy || !available || !writeEnabled || !!votes?.myVote || !votes} className={`rounded-full border px-5 py-3 text-xs font-bold transition hover:box-glow disabled:opacity-60 ${votes?.myVote === 'concern' ? 'border-destructive bg-destructive/15 text-destructive' : 'border-destructive/40 text-foreground'}`}>👎 CONCERN · {votes?.concern ?? '–'}</button>
        <span className="text-xs text-accent">{votes ? `${votes.total} ANONYMOUS REACTIONS` : available ? 'LOADING…' : 'FIELD SIGNAL OFFLINE'}</span>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">{votes?.myVote ? `Your browser voted: ${votes.myVote === 'legit' ? 'Legit' : 'Concern'}. ` : ''}These votes are stored on the server and shared across visitors. One reaction per mint per signed browser session, not one verified human. Votes are opinions, never proof of legitimacy.</p>
      {previous && !votes?.myVote && <p className="mt-2 text-xs text-accent">Your V2 reaction was saved on this browser only and was not transferred to the shared database. You can vote again.</p>}
      {(!available || writeEnabled === false) && <p className="mt-2 text-xs text-accent">Community posting is not configured or is temporarily unavailable. Scanning still works.</p>}
      {feedback && <p role="status" className="mt-2 text-xs text-accent">{feedback}</p>}
      <div className="mt-5 border-t border-primary/20 pt-5">
        <p className="mb-3 text-xs tracking-widest text-muted-foreground">SUBMIT THIS TOKEN TO THE COMMUNITY</p>
        <button type="button" onClick={() => void submit()} disabled={busy || !available || !writeEnabled || !votes} className="rounded-full border border-primary/60 bg-primary/10 px-5 py-3 text-xs font-bold text-primary disabled:opacity-40">ADD TO FIELD BOARD ↗</button>
        <p className="mt-2 text-[10px] leading-5 text-muted-foreground">Opt-in, publicly visible token mint submission. Search activity is not published automatically. Token identity and labels are not verified.</p>
        {submission && <p role="status" className="mt-2 text-xs text-accent">{submission}</p>}
      </div>
    </div>
  )
}

function Dashboard({ r }: { r: ScanResponse }) {
  const score = r.grade?.score
  const color = score === null || score === undefined ? 'text-muted-foreground' : score >= 80 ? 'text-primary glow' : score >= 60 ? 'text-accent glow-orange' : 'text-destructive'
  const circ = 2 * Math.PI * 70
  const pool = r.market.primaryPool
  const valid = r.onchain.exists === true && r.coverage.onchain
  const bars: { label: string; value: number | null; annotation: string }[] = [
    { label: 'MINT CONTROLS', value: !valid ? null : r.onchain.mintAuthority ? 25 : 100, annotation: !valid ? 'Unknown' : r.onchain.mintAuthority ? 'Authority active' : 'Authority revoked' },
    { label: 'FREEZE CONTROLS', value: !valid ? null : r.onchain.freezeAuthority ? 25 : 100, annotation: !valid ? 'Unknown' : r.onchain.freezeAuthority ? 'Authority active' : 'Authority revoked' },
    { label: 'INDEXED LIQUIDITY', value: pool?.liquidityUsd === null || pool?.liquidityUsd === undefined ? null : Math.max(0, Math.min(100, Math.round(pool.liquidityUsd / 100000 * 100))), annotation: money(pool?.liquidityUsd) },
    { label: '24H MARKET ACTIVITY', value: pool?.volume24hUsd === null || pool?.volume24hUsd === undefined ? null : Math.max(0, Math.min(100, Math.round(pool.volume24hUsd / 250000 * 100))), annotation: money(pool?.volume24hUsd) },
    { label: 'HOLDER PARTICIPATION', value: r.holders?.holders == null ? null : Math.max(0, Math.min(100, Math.round(r.holders.holders / 1000 * 100))), annotation: r.holders?.holders == null ? 'Holder feed unavailable' : `${compact(r.holders.holders)} observed holders` },
    { label: 'INDEXED TRADING HISTORY', value: r.age?.tradingDays == null ? null : Math.max(0, Math.min(100, Math.round(r.age.tradingDays / 90 * 100))), annotation: days(r.age?.tradingDays) },
    { label: 'DEX PAIR BREADTH', value: r.coverage.market ? Math.min(100, r.market.poolCount * 20) : null, annotation: `${r.market.poolCount ?? 0} indexed pairs` },
  ]
  const volumes: { label: string; value: number | null | undefined }[] = [
    { label: '1H', value: pool?.volume1hUsd },
    { label: '6H', value: pool?.volume6hUsd },
    { label: '24H', value: pool?.volume24hUsd },
  ]
  const maxVolume = Math.max(1, ...volumes.map((x) => x.value ?? 0))

  return (
    <section className="mt-10 grid gap-4 md:grid-cols-3" aria-label="Solana token scan results">
      <div className="panel animate-rise flex min-w-0 flex-col items-center rounded-2xl p-6">
        <p className="text-xs tracking-widest text-muted-foreground">HARVEST GRADE · V4 EVIDENCE-WEIGHTED</p>
        <div className="relative my-4 h-44 w-44">
          <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="80" cy="80" r="70" fill="none" stroke="var(--muted)" strokeWidth="8" />
            <circle cx="80" cy="80" r="70" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" className={color} strokeDasharray={circ} strokeDashoffset={circ * (1 - (score ?? 0) / 100)} style={{ transition: 'stroke-dashoffset 1.2s ease-out' }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`font-display text-5xl font-black ${color}`}>{r.grade.grade}</span>
            <span className="text-xs text-muted-foreground">{score === null || score === undefined ? 'NO VERIFIED FEED' : `${score}/100`}</span>
          </div>
        </div>
        <p className="text-center text-xs text-accent">{r.market.name || 'UNNAMED TOKEN'} {r.market.symbol ? `· $${r.market.symbol}` : ''}</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <span className={`rounded-full border px-3 py-1 text-[10px] font-bold tracking-widest ${r.grade.confidence === 'HIGH' ? 'border-primary/50 text-primary' : r.grade.confidence === 'MEDIUM' ? 'border-accent/50 text-accent' : 'border-destructive/50 text-destructive'}`}>
            {r.grade.confidence} CONFIDENCE
          </span>
          <span className="rounded-full border border-primary/20 px-3 py-1 text-[10px] text-muted-foreground">{r.grade.basis}</span>
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">{r.grade.stance} · {r.grade.coverageScore}% evidence coverage</p>
        <p className="mt-1 break-all text-center text-[10px] text-muted-foreground">{r.mint}</p>
        <p className="mt-3 text-center text-[10px] leading-5 text-muted-foreground">{r.grade.partial ? 'LIMITED EVIDENCE · ' : ''}{r.grade.grade === 'U' ? 'Feeds returned no verifiable observations; re-scan when data is available.' : 'Infrastructure grade, not a fraud verdict or safety guarantee.'}</p>
      </div>

      <div className="panel animate-rise min-w-0 rounded-2xl p-6 md:col-span-2" style={{ animationDelay: '.1s' }}>
        <p className="mb-4 text-xs tracking-widest text-muted-foreground">FIELD SENSORS · LIVE OBSERVATIONS</p>
        <div className="space-y-3">
          {bars.map((m) => (
            <div key={m.label}>
              <div className="flex flex-wrap justify-between gap-1 text-xs"><span>{m.label}</span><span className="text-primary">{m.annotation}</span></div>
              <div className="mt-1 h-2 rounded-full bg-muted">
                {m.value !== null && <div className={`h-full rounded-full ${m.value >= 60 ? 'bg-primary' : m.value >= 40 ? 'bg-accent' : 'bg-destructive'} box-glow`} style={{ width: `${m.value}%`, transition: 'width 1s' }} />}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-5 text-[10px] leading-5 text-muted-foreground">Bars are normalized display indicators, not independently audited safety probabilities. Market bars use $100K liquidity / $250K volume thresholds.</p>
      </div>

      {[
        { label: 'DEX LIQUIDITY', value: money(pool?.liquidityUsd) },
        { label: '24H VOLUME', value: money(pool?.volume24hUsd) },
        { label: 'MARKET CAP / FDV (DEX)', value: money(pool?.marketCap ?? pool?.fdv) },
        { label: 'TOKEN HOLDERS · INDEXED', value: compact(r.holders?.holders) },
        { label: 'MARKET CAP ÷ HOLDER', value: money(r.holders?.marketCapPerHolder) },
        { label: 'HOLDERS PER $100K MARKET CAP', value: compact(r.holders?.holdersPer100kCap) },
        { label: 'TOKEN AGE · FIRST MINT/CREATION', value: days(r.age?.ageDays) },
        { label: 'INDEXED TRADING AGE', value: days(r.age?.tradingDays) },
        { label: 'STREAMFLOW LOCKED SUPPLY', value: r.locks?.status === 'verified' && r.locks.lockedAmount != null ? compact(r.locks.lockedAmount) : 'NOT VERIFIED' },
      ].map((s, i) => (
        <div key={s.label} className="panel animate-rise min-w-0 rounded-2xl p-5" style={{ animationDelay: `${.2 + i * .05}s` }}>
          <p className="text-xs tracking-widest text-muted-foreground">{s.label}</p>
          <p className="mt-2 break-all font-display text-xl text-primary glow sm:text-2xl">{s.value}</p>
        </div>
      ))}

      <div className="panel animate-rise min-w-0 rounded-2xl p-6 md:col-span-3">
        <p className="mb-3 text-xs tracking-widest text-muted-foreground">DISTRIBUTION & LOCK VERIFICATION</p>
        <div className="grid gap-3 text-xs leading-6 md:grid-cols-2">
          <div><p className="text-primary">HOLDER DENSITY · {r.holders?.holdersPer100kCap == null ? 'UNAVAILABLE' : `${compact(r.holders.holdersPer100kCap)} / $100K CAP`}</p>
            <p className="mt-1 text-muted-foreground">{r.holders?.caveat || 'Not verified.'} This ratio does not measure whether holders are accumulating or holding longer.</p>
            {r.holders?.holderTop20Pct != null && <p className="mt-2 text-accent">Top 20 holder-address share: {compact(r.holders.holderTop20Pct)}% (may include LP/custody).</p>}
            {r.holders?.holderTop10Pct != null && <p className="mt-2 text-accent">GeckoTerminal top 10 address share: {compact(r.holders.holderTop10Pct)}%.</p>}
            <p className="mt-2 text-muted-foreground">Provider: {r.holders?.source || 'no holder provider returned data'}.</p></div>
          <div><p className="text-primary">LOCKED SUPPLY · {r.locks?.status === 'verified' ? 'CONTRACT VERIFIED' : 'NOT VERIFIED'}</p>
            <p className="mt-1 text-muted-foreground">A labeled Streamflow holder account does not prove a noncancelable lock. Credit requires checking the contract, release date, token and currently inaccessible amount. No manual claims affect the score.</p>
            {r.locks?.status === 'verified' && <p className="mt-2 text-accent">Earliest observed unlock: {when(r.locks.unlockAt)}</p>}
            <a className="mt-2 inline-block text-primary underline" href="https://app.streamflow.finance/" target="_blank" rel="noopener noreferrer">Verify token contracts on Streamflow ↗</a></div>
        </div>
        <p className="mt-3 text-[10px] text-muted-foreground">TOKEN AGE: {when(r.age?.createdAt)} ({r.age?.ageSource || 'not observed'}). TRADING AGE: {when(r.age?.firstTradingAt)} ({r.age?.tradingAgeSource || 'not observed'}). {r.age?.caveat}</p>
      </div>

      <div className="panel animate-rise min-w-0 rounded-2xl p-6 md:col-span-2" style={{ animationDelay: '.4s' }}>
        <p className="mb-4 text-xs tracking-widest text-muted-foreground">INDEXED VOLUME WINDOWS · 1H / 6H / 24H</p>
        <div className="flex h-32 items-end gap-5">
          {volumes.map((item) => <div key={item.label} className="flex flex-1 flex-col items-center gap-2">
            <span className="text-[10px] text-primary">{money(item.value)}</span>
            <div className="flex h-20 w-full items-end"><div className="w-full rounded-t bg-gradient-to-t from-primary/20 to-primary" style={{ height: item.value === null || item.value === undefined ? '0%' : `${Math.max(3, item.value / maxVolume * 100)}%` }} /></div>
            <span className="text-xs text-muted-foreground">{item.label}</span>
          </div>)}
        </div>
        <p className="mt-4 text-[10px] leading-5 text-muted-foreground">These are overlapping volume windows from the primary indexed DEX pool, not a historical trend. 3D / 7D / 30D tracking is not yet connected.</p>
      </div>

      <div className="panel animate-rise min-w-0 rounded-2xl p-6" style={{ animationDelay: '.5s' }}>
        <p className="mb-4 text-xs tracking-widest text-muted-foreground">CROWS SPOTTED · EVIDENCE</p>
        <ul className="space-y-3 text-xs">
          {r.assessment.signals.length === 0 && <li className="text-muted-foreground">No elevated indicator observed in the available data. This is not a safety certification.</li>}
          {r.assessment.signals.map((f) => (
            <li key={f.id} className="break-words leading-5">
              <span className={f.severity === 'information' ? 'text-primary' : f.severity === 'attention' ? 'text-accent' : 'text-destructive'}>{f.severity === 'elevated' ? '✖' : f.severity === 'attention' ? '◆' : '▲'} {f.title}</span>
              <p className="mt-1 text-muted-foreground">{f.description}</p>
              {f.evidenceUrl && <a href={f.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">VIEW SOURCE ↗</a>}
            </li>
          ))}
        </ul>
      </div>

      <div className="panel animate-rise min-w-0 rounded-2xl p-6 md:col-span-3">
        <p className="mb-3 text-xs tracking-widest text-muted-foreground">DUPLICATE WATCH · SIMILAR MINTS</p>
        {!r.coverage.similar ? <p className="text-xs text-muted-foreground">Duplicate search unavailable.</p> : r.market.similar.length === 0 ? <p className="text-xs text-muted-foreground">No matching alternatives found in the limited indexed search. This does not verify uniqueness.</p> : (
          <div className="grid gap-2 lg:grid-cols-2">
            {r.market.similar.map((item) => <div key={item.mint} className="min-w-0 rounded-xl border border-primary/20 bg-background/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-xs text-primary">{item.name || 'Unnamed'} · {item.symbol || '?'}</strong>
                <span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${item.verdict?.label === 'POSSIBLE DUP' ? 'border-accent text-accent' : 'border-primary/40 text-muted-foreground'}`}>{item.verdict?.label || 'NAME MATCH'}</span>
              </div>
              <p className="my-2 break-all text-[10px] text-muted-foreground">{item.mint}</p>
              <p className="text-xs">VOL {money(item.volume24hUsd)} · LIQ {money(item.liquidityUsd)} · MCAP {money(item.marketCap ?? item.fdv)}</p>
              {item.verdict?.reasons?.length ? <p className="mt-2 text-[10px] leading-5 text-muted-foreground">{item.verdict.reasons.join(' · ')}</p> : null}
              <a className="mt-3 inline-block text-xs text-primary underline" target="_blank" rel="noopener noreferrer" href={item.sourceUrl}>Inspect this mint ↗</a>
            </div>)}
          </div>
        )}
        <p className="mt-4 text-[10px] leading-5 text-muted-foreground">{r.market.duplicateCaveat}</p>
      </div>

      <div className="panel animate-rise min-w-0 rounded-2xl p-6 md:col-span-3">
        <p className="mb-3 text-xs tracking-widest text-muted-foreground">GRADE EXPLANATION & DATA COVERAGE</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-2 text-xs text-primary">INPUTS USED · {r.grade.basis}</p>
            <ul className="space-y-2 text-xs text-muted-foreground">{r.grade.reasons.map((reason) => <li key={reason}>✓ {reason}</li>)}</ul>
            {r.concentration && <p className="mt-4 text-xs text-muted-foreground">Top 10 token accounts: {r.concentration.top10TokenAccountsPct}% · includes liquidity/custody accounts, not individual holders.</p>}
          </div>
          <div>
            <p className="mb-2 text-xs text-accent">MISSING / NOT YET VERIFIED</p>
            <ul className="space-y-2 text-xs text-muted-foreground">{r.grade.unavailable.map((missing) => <li key={missing}>— {missing}</li>)}</ul>
            <p className="mt-4 text-[10px] leading-5 text-muted-foreground">{r.grade.formula}</p>
          </div>
        </div>
        <p className="mt-4 text-[10px] leading-5 text-accent">Confidence measures evidence coverage, not the probability that a coin is safe. A DEX-only grade does not verify mint or freeze controls.</p>
        <p className="mt-5 break-words text-[10px] leading-5 text-muted-foreground">Checked {new Date(r.checkedAt).toLocaleString()} · Sources: {r.sourceLinks.map((link) => <a key={link} className="mr-3 inline-block text-primary underline" href={link} target="_blank" rel="noopener noreferrer">{link.includes('solscan') ? 'SOLSCAN ↗' : link.includes('geckoterminal') ? 'GECKOTERMINAL ↗' : link.includes('streamflow') ? 'STREAMFLOW ↗' : 'DEX SCREENER ↗'}</a>)}</p>
      </div>

      <Reactions mint={r.mint} tokenLabel={r.market.symbol ? `$${r.market.symbol}` : ''} />
      <p className="text-center text-[10px] leading-6 text-muted-foreground md:col-span-3">Data is read-only and partially indexed. A higher grade, higher trading volume, or a community reaction cannot verify that a token is legitimate. Scarecrow does not request wallet access.</p>
    </section>
  )
}
