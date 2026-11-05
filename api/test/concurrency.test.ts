import { describe, expect, it } from 'vitest'
import { call, createBill, createHome } from './helpers'

async function setup() {
  const { homeId } = await createHome(['Asha', 'Ben'])
  const bill = await createBill(homeId, 1000)
  const share = bill.body.shares[0]
  if (!share) throw new Error('bill has no shares')
  return { homeId, path: `/api/bills/${bill.body.id}/shares/${share.id}/pay` }
}

describe('concurrent payments', () => {
  it('lets only one of two simultaneous payments with different keys win', async () => {
    const { path } = await setup()

    const [a, b] = await Promise.all([
      call('POST', path, { headers: { 'Idempotency-Key': 'key-a' } }),
      call('POST', path, { headers: { 'Idempotency-Key': 'key-b' } }),
    ])

    expect([a.status, b.status].sort()).toEqual([200, 409])
  })

  it('answers both with the same result when the same key is sent at once', async () => {
    const { path } = await setup()

    const [a, b] = await Promise.all([
      call<{ paidAt: string }>('POST', path, { headers: { 'Idempotency-Key': 'same' } }),
      call<{ paidAt: string }>('POST', path, { headers: { 'Idempotency-Key': 'same' } }),
    ])

    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(a.body.paidAt).toBe(b.body.paidAt)
  })

  it('counts a share as paid only once in the balances', async () => {
    const { homeId, path } = await setup()

    await Promise.all([
      call('POST', path, { headers: { 'Idempotency-Key': 'key-a' } }),
      call('POST', path, { headers: { 'Idempotency-Key': 'key-b' } }),
    ])

    const balances = await call<{ balances: { outstandingCents: number }[] }>(
      'GET',
      `/api/homes/${homeId}/balances`,
    )
    expect(balances.body.balances.map((b) => b.outstandingCents)).toEqual([0, 500])
  })
})
