export type Share = {
  id: string
  memberId: string
  memberName: string
  amountCents: number
  paidAt: string | null
}

export type Bill = { id: string; title: string; totalCents: number; shares: Share[] }
export type Balance = { memberId: string; name: string; outstandingCents: number }

const TIMEOUT_MS = 10_000

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Please try again.'
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function readError(data: unknown, status: number): string {
  if (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof data.error === 'string'
  ) {
    return data.error
  }
  return `Request failed (status ${status})`
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json', ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    })
    const data = parseJson(await response.text())
    if (!response.ok) {
      throw new ApiError(readError(data, response.status), response.status)
    }
    return data as T
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('The server took too long to answer. Please try again.', 0)
    }
    throw new ApiError('Could not reach the server. Check your connection.', 0)
  } finally {
    clearTimeout(timer)
  }
}

export const createHome = (name: string) =>
  request<{ id: string; name: string }>('POST', '/api/homes', { body: { name } })

export const addMember = (homeId: string, name: string) =>
  request<{ id: string }>('POST', `/api/homes/${homeId}/members`, { body: { name } })

export const createBill = (homeId: string, title: string, totalCents: number) =>
  request<{ id: string }>('POST', `/api/homes/${homeId}/bills`, { body: { title, totalCents } })

export const listBills = (homeId: string) =>
  request<{ bills: Bill[] }>('GET', `/api/homes/${homeId}/bills`)

export const getBalances = (homeId: string) =>
  request<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)

export const payShare = (billId: string, shareId: string, idempotencyKey: string) =>
  request<{ id: string; paidAt: string }>('POST', `/api/bills/${billId}/shares/${shareId}/pay`, {
    headers: { 'Idempotency-Key': idempotencyKey },
  })
