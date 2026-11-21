// eslint-disable-next-line import/no-default-export
export default async function auth(request: Request): Promise<Response> {
  const { getAuth } = await import('../_lib/auth.js')
  return (await getAuth()).handler(request)
}
