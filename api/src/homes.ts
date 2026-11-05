import { Hono } from 'hono'
import { readJson } from './http'

export const homes = new Hono<{ Bindings: Env }>()

function parseName(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('name' in body)) {
    return null
  }
  const { name } = body
  if (typeof name !== 'string') {
    return null
  }
  const trimmed = name.trim()
  return trimmed.length > 0 ? trimmed : null
}

homes.post('/', async (c) => {
  const name = parseName(await readJson(c.req.raw))
  if (name === null) {
    return c.json({ error: 'name must be a non-empty string' }, 422)
  }

  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()

  return c.json({ id, name }, 201)
})

homes.post('/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (home === null) {
    return c.json({ error: 'home not found' }, 404)
  }

  const name = parseName(await readJson(c.req.raw))
  if (name === null) {
    return c.json({ error: 'name must be a non-empty string' }, 422)
  }

  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)')
    .bind(id, homeId, name)
    .run()

  return c.json({ id, homeId, name }, 201)
})
