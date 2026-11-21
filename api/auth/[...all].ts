// eslint-disable-next-line import/no-default-export
export default async function auth(request: Request): Promise<Response> {
  try {
    const { getAuth } = await import('../_lib/auth.js')
    return (await getAuth()).handler(request)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      '[api/auth] request failed',
      error instanceof Error ? error.message : 'unknown error'
    )
    return Response.json({ error: 'service_unavailable' }, { status: 503 })
  }
}
