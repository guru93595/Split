export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

export function field(body: unknown, key: string): unknown {
  if (typeof body !== 'object' || body === null) {
    return undefined
  }
  return (body as Record<string, unknown>)[key]
}
