import { Hono } from 'hono'
import { field, readJson } from './http'
import { shareAmount } from './split'

export const bills = new Hono<{ Bindings: Env }>()

type MemberRow = { id: string }

type BillShareRow = {
  bill_id: string
  title: string
  total_cents: number
  share_id: string
  member_id: string
  member_name: string
  amount_cents: number
  paid_at: string | null
}

type BillView = {
  id: string
  title: string
  totalCents: number
  shares: {
    id: string
    memberId: string
    memberName: string
    amountCents: number
    paidAt: string | null
  }[]
}

bills.post('/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (home === null) {
    return c.json({ error: 'home not found' }, 404)
  }

  const body = await readJson(c.req.raw)
  const title = field(body, 'title')
  const totalCents = field(body, 'totalCents')

  if (typeof title !== 'string' || title.trim().length === 0) {
    return c.json({ error: 'title must be a non-empty string' }, 422)
  }
  if (typeof totalCents !== 'number' || !Number.isSafeInteger(totalCents) || totalCents <= 0) {
    return c.json({ error: 'totalCents must be a positive whole number' }, 422)
  }

  const { results: members } = await c.env.DB.prepare(
    'SELECT id FROM members WHERE home_id = ? ORDER BY seq',
  )
    .bind(homeId)
    .all<MemberRow>()

  if (members.length === 0) {
    return c.json({ error: 'home has no members' }, 422)
  }

  const billId = crypto.randomUUID()
  const cleanTitle = title.trim()

  const shares = members.map((member, index) => ({
    id: crypto.randomUUID(),
    memberId: member.id,
    amountCents: shareAmount(totalCents, members.length, index),
    paidAt: null,
  }))

  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    ).bind(billId, homeId, cleanTitle, totalCents),
    ...shares.map((share) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?)',
      ).bind(share.id, billId, share.memberId, share.amountCents),
    ),
  ])

  return c.json({ id: billId, homeId, title: cleanTitle, totalCents, shares }, 201)
})

bills.get('/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (home === null) {
    return c.json({ error: 'home not found' }, 404)
  }

  const { results } = await c.env.DB.prepare(
    `SELECT b.id AS bill_id, b.title AS title, b.total_cents AS total_cents,
            s.id AS share_id, s.member_id AS member_id, m.name AS member_name,
            s.amount_cents AS amount_cents, s.paid_at AS paid_at
     FROM bills b
     JOIN shares s ON s.bill_id = b.id
     JOIN members m ON m.id = s.member_id
     WHERE b.home_id = ?
     ORDER BY b.seq DESC, m.seq ASC`,
  )
    .bind(homeId)
    .all<BillShareRow>()

  const grouped = new Map<string, BillView>()
  for (const row of results) {
    let bill = grouped.get(row.bill_id)
    if (bill === undefined) {
      bill = { id: row.bill_id, title: row.title, totalCents: row.total_cents, shares: [] }
      grouped.set(row.bill_id, bill)
    }
    bill.shares.push({
      id: row.share_id,
      memberId: row.member_id,
      memberName: row.member_name,
      amountCents: row.amount_cents,
      paidAt: row.paid_at,
    })
  }

  return c.json({ bills: [...grouped.values()] })
})
