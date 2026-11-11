import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { config, expandHome, runtimeEnv } from './config.ts'
import { publish } from './publish.ts'
import type { Collection } from './protocol.ts'

type Run = (command: string, args: string[], home: string, state: string) => { status: number | null; stdout: string; stderr: string }
const execute: Run = (command, args, home, state) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 630_000, maxBuffer: 2 * 1024 * 1024,
    cwd: expandHome(config(state).collectorCwd || home, home), env: { ...runtimeEnv(), PING_INBOX_STATE: state } })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? result.error?.message ?? '' }
}
const store = (state: string, value: Collection) => {
  const file = join(state, 'manual-collection.json')
  writeFileSync(file + '.tmp', JSON.stringify(value), { mode: 0o600 })
  renameSync(file + '.tmp', file)
}

export function collectionStatus(state: string): Collection | undefined {
  const file = join(state, 'manual-collection.json')
  if (!existsSync(file)) return undefined
  const value: Collection = JSON.parse(readFileSync(file, 'utf8'))
  if (value.status === 'running' && value.pid) {
    try { process.kill(value.pid, 0) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return { ...value, status: 'failed', message: 'Collection worker stopped; inspect manual-collection.lock before retrying' }
      throw error
    }
  }
  return value
}

export function requestCollection(state: string, home: string, launch: (state: string, home: string) => void = (state: string, home: string) => {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--run', state, home], { detached: true, stdio: 'ignore' })
  child.on('error', error => {
    store(state, { status: 'failed', startedAt: Date.now(), message: error.message })
    try { rmdirSync(join(state, 'manual-collection.lock')) } catch { /* 시작하지 못한 잠금만 정리한다. */ }
  })
  child.unref()
}) {
  if (!config(state).collectorCommand.length) throw new Error('Configure collectorCommand in the state config.json first')
  mkdirSync(state, { recursive: true, mode: 0o700 })
  try { mkdirSync(join(state, 'manual-collection.lock')) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    // 강제 종료 뒤 남은 잠금은 실행 여부 확인 없이 자동으로 지우지 않는다.
    if (collectionStatus(state)?.status === 'failed') throw new Error('Previous collection lock needs recovery; check manual-collection.lock')
    return
  }
  const pending: Collection = { status: 'running', pid: process.pid, startedAt: Date.now(), message: '새 알림을 수집하고 있습니다. 완료하면 화면에 반영됩니다.' }
  store(state, pending)
  try { launch(state, home) }
  catch (error) {
    store(state, { status: 'failed', startedAt: Date.now(), message: error instanceof Error ? error.message : String(error) })
    rmdirSync(join(state, 'manual-collection.lock'))
    throw error
  }
}

export function runCollection(state: string, home: string, run: Run = execute) {
  const startedAt = collectionStatus(state)?.startedAt ?? Date.now()
  store(state, { status: 'running', pid: process.pid, startedAt, message: '새 알림을 수집하고 있습니다. 완료하면 화면에 반영됩니다.' })
  const report = join(state, 'report.md')
  const previous = existsSync(report) ? readFileSync(report, 'utf8') : ''
  try {
    const [command, ...args] = config(state).collectorCommand
    if (!command) throw new Error('Collector command is not configured')
    const result = run(expandHome(command, home), args.map(arg => expandHome(arg, home)), home, state)
    if (result.status !== 0) {
      writeFileSync(join(state, 'manual-collection.log'), result.stderr.slice(0, 65536), { mode: 0o600 })
      throw new Error('Collection failed or timed out; inspect the private manual-collection.log')
    }
    publish(state, result.stdout)
    const current = existsSync(report) ? readFileSync(report, 'utf8') : ''
    store(state, { status: 'complete', startedAt, message: current !== previous ? '수집과 보고를 마쳤습니다.' : '수집을 마쳤습니다. 새 알림이 없습니다.' })
  } catch (error) {
    store(state, { status: 'failed', startedAt, message: error instanceof Error ? error.message : String(error) })
  } finally { rmdirSync(join(state, 'manual-collection.lock')) }
}

if (process.argv[1] && existsSync(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  if (process.argv[2] !== '--run' || !process.argv[3]) throw new Error('Invalid collection invocation')
  runCollection(process.argv[3], process.argv[4] ?? homedir())
}
