import { Hono } from 'hono'
import { bills } from './bills'
import { homes } from './homes'
import { payments } from './payments'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) => c.json({ status: 'ok' }))
app.route('/api/homes', homes)
app.route('/api', bills)
app.route('/api', payments)

app.notFound((c) => c.json({ error: 'not found' }, 404))

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'internal server error' }, 500)
})
export default app
