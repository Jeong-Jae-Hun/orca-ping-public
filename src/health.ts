import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { differenceInMinutes } from '../vendor/date.js'
import type { SourceHealth } from './protocol.ts'
export function sourceHealth(state: string, now = Date.now()): SourceHealth[] {
  const file = join(state, 'source-health.json')
  if (!existsSync(file)) return []
  try {
    const values: SourceHealth[] = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(values)) throw new Error('Invalid source status')
    return values.map(item => ({ ...item, status: item.checkedAt && item.checkedAt <= now && differenceInMinutes(now, item.checkedAt) > 120 && item.status !== 'failed' ? 'stale' : item.status }))
  } catch { return [{ id: 'collector', title: '수집기', status: 'unknown', checkedAt: null, message: 'Invalid source status' }] }
}
