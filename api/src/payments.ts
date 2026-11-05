import { Hono } from 'hono'

export const payments = new Hono<{ Bindings: Env }>()

type ShareRow = {
  id: string
  member_id: string
  amount_cents: number
  paid_at: string | null
  idempotency_key: string | null
}

type BalanceRow = {
  member_id: string
  name: string
  outstanding_cents: number
}

payments.post('/bills/:billId/shares/:shareId/pay', async (c) => {
  const key = c.req.header('Idempotency-Key')?.trim()
  if (!key) {
    return c.json({ error: 'Idempotency-Key header is required' }, 400)
  }

  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')

  const update = await c.env.DB.prepare(
    'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND bill_id = ? AND paid_at IS NULL',
  )
    .bind(new Date().toISOString(), key, shareId, billId)
    .run()

  const share = await c.env.DB.prepare(
    'SELECT id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<ShareRow>()

  if (share === null) {
    return c.json({ error: 'bill or share not found' }, 404)
  }

  const paidNow = update.meta.changes === 1
  if (!paidNow && share.idempotency_key !== key) {
    return c.json({ error: 'share already paid with a different key' }, 409)
  }

  return c.json(
    {
      id: share.id,
      memberId: share.member_id,
      amountCents: share.amount_cents,
      paidAt: share.paid_at,
    },
    200,
  )
})

payments.get('/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (home === null) {
    return c.json({ error: 'home not found' }, 404)
  }

  const { results } = await c.env.DB.prepare(
    `SELECT m.id AS member_id, m.name AS name, COALESCE(SUM(s.amount_cents), 0) AS outstanding_cents
     FROM members m
     LEFT JOIN shares s ON s.member_id = m.id AND s.paid_at IS NULL
     WHERE m.home_id = ?
     GROUP BY m.seq
     ORDER BY m.seq`,
  )
    .bind(homeId)
    .all<BalanceRow>()

  return c.json({
    balances: results.map((row) => ({
      memberId: row.member_id,
      name: row.name,
      outstandingCents: row.outstanding_cents,
    })),
  })
})
