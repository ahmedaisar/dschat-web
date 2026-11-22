/* eslint-disable curly */
import { createHash, randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '../db.js'
import { creditAccount, creditReservation, creditTransaction, model } from '../../db/schema.js'

const UNIT = 1_000_000n
const MAX_KEY_LENGTH = 200

export class ReservationError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, status: number, message: string) { super(message); this.code = code; this.status = status }
}

export type ReservationInput = { modelId: string; messages: unknown[]; maxOutputTokens?: number }
export type ReservationResult = { id: string; maximum: bigint; expiresAt: Date; replayed: boolean }

const hash = (value: string): string => createHash('sha256').update(value).digest('hex')
const charge = (tokens: number, rate: bigint): bigint => (BigInt(tokens) * rate + UNIT - 1n) / UNIT
const stable = (value: unknown): string => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item)
const textLength = (value: unknown): number => typeof value === 'string' ? value.length : Array.isArray(value) ? value.reduce((sum, item) => sum + textLength(item), 0) : value && typeof value === 'object' ? Object.values(value).reduce((sum, item) => sum + textLength(item), 0) : 0

export const reserveCredits = async (userId: string, key: string, input: ReservationInput): Promise<ReservationResult> => {
  if (!key || key.length > MAX_KEY_LENGTH) throw new ReservationError('invalid_idempotency_key', 400, 'Invalid idempotency key')
  if (!input.modelId || !Array.isArray(input.messages) || input.messages.length > 100) throw new ReservationError('invalid_request', 400, 'Invalid inference request')
  const fingerprint = hash(stable(input))
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000)
  return getDb().transaction(async (tx) => {
    const existing = await tx.query.creditReservation.findFirst({ where: and(eq(creditReservation.userId, userId), eq(creditReservation.idempotencyKey, key)) })
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) throw new ReservationError('idempotency_conflict', 409, 'Idempotency key was used for another request')
      return { id: existing.id, maximum: existing.maximum, expiresAt: existing.expiresAt, replayed: true }
    }
    const selected = await tx.query.model.findFirst({ where: and(eq(model.id, input.modelId), eq(model.enabled, true)) })
    if (!selected) throw new ReservationError('model_unavailable', 400, 'Requested model is unavailable')
    const output = input.maxOutputTokens ?? selected.maxOutputTokens
    if (!Number.isInteger(output) || output < 1 || output > selected.maxOutputTokens) throw new ReservationError('invalid_request', 400, 'Invalid output limit')
    const inputTokens = Math.min(selected.contextWindow, Math.max(1, Math.ceil(textLength(input.messages) / 4)))
    if (inputTokens + output > selected.contextWindow) throw new ReservationError('invalid_request', 400, 'Request exceeds model context limit')
    const maximum = charge(inputTokens, selected.inputRate) + charge(output, selected.outputRate)
    if (maximum <= 0n) throw new ReservationError('invalid_request', 400, 'Request has no billable cost')
    await tx.insert(creditAccount).values({ userId, available: 0n, reserved: 0n, createdAt: now, updatedAt: now }).onConflictDoNothing()
    const account = await tx.query.creditAccount.findFirst({ where: eq(creditAccount.userId, userId) })
    if (!account || account.available < maximum) throw new ReservationError('insufficient_credits', 402, 'Insufficient credits')
    const reservationId = randomUUID()
    await tx.update(creditAccount).set({ available: sql`${creditAccount.available} - ${maximum}`, reserved: sql`${creditAccount.reserved} + ${maximum}`, updatedAt: now }).where(eq(creditAccount.userId, userId))
    await tx.insert(creditReservation).values({ id: reservationId, userId, state: 'active', maximum, idempotencyKey: key, requestFingerprint: fingerprint, expiresAt, createdAt: now })
    await tx.insert(creditTransaction).values({ id: randomUUID(), userId, type: 'reservation', amount: -maximum, balanceBefore: account.available, balanceAfter: account.available - maximum, idempotencyKey: `reservation:${reservationId}`, reservationId, metadata: { modelId: input.modelId }, createdAt: now })
    return { id: reservationId, maximum, expiresAt, replayed: false }
  })
}

export const settleReservation = async (userId: string, reservationId: string, actual: bigint, key: string): Promise<boolean> => getDb().transaction(async (tx) => {
  const row = await tx.query.creditReservation.findFirst({ where: and(eq(creditReservation.id, reservationId), eq(creditReservation.userId, userId)) })
  if (!row || row.state !== 'active' || actual < 0n || actual > row.maximum) return false
  const refund = row.maximum - actual
  const now = new Date()
  await tx.update(creditAccount).set({ reserved: sql`${creditAccount.reserved} - ${row.maximum}`, available: sql`${creditAccount.available} + ${refund}`, updatedAt: now }).where(eq(creditAccount.userId, userId))
  await tx.update(creditReservation).set({ state: 'settled', version: row.version + 1 }).where(eq(creditReservation.id, reservationId))
  await tx.insert(creditTransaction).values({ id: randomUUID(), userId, type: 'settlement', amount: -actual, balanceBefore: 0n, balanceAfter: 0n, idempotencyKey: key, reservationId, metadata: { reserved: row.maximum.toString() }, createdAt: now })
  return true
})

export const releaseReservation = async (userId: string, reservationId: string, key: string): Promise<boolean> => getDb().transaction(async (tx) => {
  const row = await tx.query.creditReservation.findFirst({ where: and(eq(creditReservation.id, reservationId), eq(creditReservation.userId, userId)) })
  if (!row || row.state !== 'active') return false
  const now = new Date()
  await tx.update(creditAccount).set({ available: sql`${creditAccount.available} + ${row.maximum}`, reserved: sql`${creditAccount.reserved} - ${row.maximum}`, updatedAt: now }).where(eq(creditAccount.userId, userId))
  await tx.update(creditReservation).set({ state: 'released', version: row.version + 1 }).where(eq(creditReservation.id, reservationId))
  await tx.insert(creditTransaction).values({ id: randomUUID(), userId, type: 'release', amount: row.maximum, balanceBefore: 0n, balanceAfter: 0n, idempotencyKey: key, reservationId, createdAt: now })
  return true
})
