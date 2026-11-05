import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  addMember,
  type Balance,
  type Bill,
  createBill,
  createHome,
  getBalances,
  listBills,
  messageOf,
  payShare,
  type Share,
} from '../api'

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): { homeId?: string } =>
    typeof search.homeId === 'string' ? { homeId: search.homeId } : {},
  component: Page,
})

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; bills: Bill[]; balances: Balance[] }

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function Page() {
  const { homeId } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <main className="app">
      <header className="app-header">
        <h1>Bill splitter</h1>
        {homeId !== undefined && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate({ to: '/', search: {} })}
          >
            Use another home
          </button>
        )}
      </header>
      {homeId === undefined ? (
        <section className="card">
          <h2>Start a new home</h2>
          <TextForm
            label="Home name"
            placeholder="e.g. Flat 4B"
            button="Create home"
            onSubmit={async (name) => {
              const home = await createHome(name)
              await navigate({ to: '/', search: { homeId: home.id } })
            }}
          />
        </section>
      ) : (
        <HomeView key={homeId} homeId={homeId} />
      )}
    </main>
  )
}

function TextForm(props: {
  label: string
  placeholder?: string
  button: string
  onSubmit: (value: string) => Promise<void>
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await props.onSubmit(value)
      setValue('')
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-row">
        <label className="field">
          {props.label}
          <input
            value={value}
            placeholder={props.placeholder}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving...' : props.button}
        </button>
      </div>
      {error !== null && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}

function BillForm(props: { onSubmit: (title: string, totalCents: number) => Promise<void> }) {
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await props.onSubmit(title, Number(amount))
      setTitle('')
      setAmount('')
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-row">
        <label className="field">
          Bill title
          <input
            value={title}
            placeholder="e.g. Electricity"
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="field">
          Amount (cents)
          <input
            value={amount}
            placeholder="e.g. 1000"
            inputMode="numeric"
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving...' : 'Add bill'}
        </button>
      </div>
      <p className="hint">Whole cents only: 1000 means $10.00.</p>
      {error !== null && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}

function HomeView({ homeId }: { homeId: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [paying, setPaying] = useState<ReadonlySet<string>>(new Set())
  const [payErrors, setPayErrors] = useState<Record<string, string>>({})
  const latest = useRef(0)
  const keys = useRef(new Map<string, string>())

  const load = useCallback(
    async (silent: boolean) => {
      latest.current += 1
      const ticket = latest.current
      if (!silent) {
        setState({ status: 'loading' })
      }
      try {
        const [billsResult, balancesResult] = await Promise.all([
          listBills(homeId),
          getBalances(homeId),
        ])
        if (ticket === latest.current) {
          setState({
            status: 'ready',
            bills: billsResult.bills,
            balances: balancesResult.balances,
          })
        }
      } catch (caught) {
        if (ticket === latest.current && !silent) {
          setState({ status: 'error', message: messageOf(caught) })
        }
      }
    },
    [homeId],
  )

  useEffect(() => {
    void load(false)
  }, [load])

  async function pay(bill: Bill, share: Share) {
    const key = keys.current.get(share.id) ?? crypto.randomUUID()
    keys.current.set(share.id, key)
    setPaying((prev) => new Set(prev).add(share.id))
    setPayErrors((prev) => {
      const { [share.id]: _removed, ...rest } = prev
      return rest
    })
    try {
      await payShare(bill.id, share.id, key)
      keys.current.delete(share.id)
      await load(true)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        keys.current.delete(share.id)
      }
      setPayErrors((prev) => ({ ...prev, [share.id]: messageOf(caught) }))
    } finally {
      setPaying((prev) => {
        const next = new Set(prev)
        next.delete(share.id)
        return next
      })
    }
  }

  return (
    <div>
      <section className="card">
        <h2>Add a member</h2>
        <TextForm
          label="Member name"
          placeholder="e.g. Asha"
          button="Add member"
          onSubmit={async (name) => {
            await addMember(homeId, name)
            await load(true)
          }}
        />
      </section>

      <section className="card">
        <h2>New bill</h2>
        <BillForm
          onSubmit={async (title, totalCents) => {
            await createBill(homeId, title, totalCents)
            await load(true)
          }}
        />
      </section>

      {state.status === 'loading' && <p className="muted">Loading...</p>}

      {state.status === 'error' && (
        <div className="alert" role="alert">
          <div>{state.message}</div>
          <button type="button" className="btn btn-secondary" onClick={() => void load(false)}>
            Try again
          </button>
        </div>
      )}

      {state.status === 'ready' && (
        <>
          <section className="card">
            <h2>Who owes what</h2>
            {state.balances.length === 0 ? (
              <p className="muted">No members yet. Add a member before creating a bill.</p>
            ) : (
              <ul className="list">
                {state.balances.map((balance) => (
                  <li key={balance.memberId} className="list-item">
                    <span>{balance.name}</span>
                    <span className={balance.outstandingCents === 0 ? 'amount settled' : 'amount'}>
                      {formatCents(balance.outstandingCents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <h2>Bills</h2>
          {state.bills.length === 0 ? (
            <p className="muted">No bills yet. Add one above.</p>
          ) : (
            state.bills.map((bill) => (
              <section key={bill.id} className="card">
                <div className="bill-header">
                  <h3>{bill.title}</h3>
                  <span className="amount">{formatCents(bill.totalCents)}</span>
                </div>
                <ul className="list">
                  {bill.shares.map((share) => (
                    <li key={share.id} className="list-item">
                      <span>{share.memberName}</span>
                      <span className="share-right">
                        <span className="amount">{formatCents(share.amountCents)}</span>
                        {share.paidAt !== null ? (
                          <span className="badge-paid">
                            Paid {new Date(share.paidAt).toLocaleDateString()}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-primary btn-small"
                            disabled={paying.has(share.id)}
                            onClick={() => void pay(bill, share)}
                          >
                            {paying.has(share.id) ? 'Paying...' : 'Pay'}
                          </button>
                        )}
                      </span>
                      {payErrors[share.id] !== undefined && (
                        <p className="alert alert-inline" role="alert">
                          {payErrors[share.id]}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </div>
  )
}
