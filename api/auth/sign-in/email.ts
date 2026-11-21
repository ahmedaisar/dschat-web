import type { IncomingMessage, ServerResponse } from 'node:http'
import { authNodeHandler } from '../../_lib/auth-handler.js'

// eslint-disable-next-line import/no-default-export
export default async function signInEmail(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  await authNodeHandler(request, response)
}
