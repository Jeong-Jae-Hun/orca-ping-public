import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expandHome, runtimeEnv } from './config.ts'
import type { OrcaWorkerApi } from 'orca/worker'
import type { Request, Snapshot, View } from './protocol.ts'

type Transport = (input: Request) => Promise<Snapshot>
type Runtime = { orca: OrcaWorkerApi; call: Transport; pending: Promise<View> | null; view: View }
let timer: ReturnType<typeof setInterval> | undefined

export type Connection = { mode?: string; sshHost?: string; backendEntry?: string; stateDirectory?: string; nodeExecutable?: string; orcaExecutable?: string; pluginKey?: string }
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
const shellPath = (value: string) => value.startsWith('~/') ? '"$HOME"/' + quote(value.slice(2)) : quote(value)
export function transport(input: Request, settings: Connection = {}): Promise<Snapshot> {
  const node = settings.nodeExecutable || 'node'
  let command = expandHome(node)
  let args = [settings.backendEntry ? expandHome(settings.backendEntry) : fileURLToPath(new URL('./bridge.ts', import.meta.url))]
  if (settings.stateDirectory) args.push('--state', expandHome(settings.stateDirectory))
  if (settings.mode && !['local', 'ssh'].includes(settings.mode)) return Promise.reject(new Error('Connection mode must be local or ssh'))
  if (settings.mode === 'ssh') {
    if (!settings.sshHost || !/^[a-zA-Z0-9][a-zA-Z0-9@._-]*$/.test(settings.sshHost) || !settings.backendEntry) return Promise.reject(new Error('Configure a valid SSH host and backendEntry'))
    command = 'ssh'
    const remoteArgs = [shellPath(node), shellPath(settings.backendEntry)]
    if (settings.stateDirectory) remoteArgs.push('--state', shellPath(settings.stateDirectory))
    args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '--', settings.sshHost,
      'export PATH="$HOME/.local/bin:$HOME/.volta/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"; ' + remoteArgs.join(' ')]
  }
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { env: runtimeEnv(), timeout: 100_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) { reject(new Error('Backend unavailable: ' + error.message.split('\n')[0])); return }
      try {
        const snapshot = JSON.parse(stdout)
        if (!snapshot || typeof snapshot.batch !== 'string' || typeof snapshot.report !== 'string' || !Array.isArray(snapshot.proposals)) throw new Error('Invalid inbox response')
        resolve(snapshot)
      } catch (error) { reject(error) }
    })
    child.stdin?.end(JSON.stringify(input))
  })
}

async function refresh(runtime: Runtime, input: Request = { action: 'snapshot' }): Promise<View> {
  const { orca, call } = runtime
  let snapshot = await orca.storage.get('snapshot') as Snapshot | null
  let error: string | null = null
  try {
    snapshot = await call(input)
    await orca.storage.set('snapshot', snapshot)
    const reminded = (await orca.storage.get('reminded') ?? {}) as Record<string, number>
    const due = (snapshot.reminders ?? []).filter(item => reminded[item.id] !== item.until)
    if (due.length) {
      const delivered = await orca.host.call('notifications.show', { title: `Ping Inbox · 다시 볼 시간 ${due.length}건`, body: due.slice(0, 3).map(item => item.title).join('\n') })
      if (delivered.delivered) {
        for (const item of due) reminded[item.id] = item.until
        await orca.storage.set('reminded', reminded)
      }
    }
    const previous = await orca.storage.get('notified')
    if (snapshot.report.trim() && previous !== snapshot.batch && (!snapshot.judgments || snapshot.judgments.some(item => item.priority === 'urgent' || item.priority === 'today'))) {
      const delivered = await orca.host.call('notifications.show', { title: 'Ping Inbox', body: snapshot.judgments?.find(item => item.priority === 'urgent')?.title ?? snapshot.report.trim().split('\n').at(-1) })
      if (delivered.delivered) await orca.storage.set('notified', snapshot.batch)
    }
    if (snapshot.judgments && !snapshot.judgments.some(item => item.priority === 'urgent' || item.priority === 'today')) await orca.storage.set('notified', snapshot.batch)
    const urgent = snapshot.judgments?.filter(item => item.priority === 'urgent').length ?? 0
    await orca.host.call('statusBar.update', { id: 'ping', text: urgent ? `핑 · 급함 ${urgent}건` : `핑 · ${snapshot.proposals.length}건`, tone: 'neutral', tooltip: 'Ping Inbox 열기' })
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
    orca.log(error)
    await orca.host.call('statusBar.update', { id: 'ping', text: '핑 · 연결 확인', tone: 'warning', tooltip: error })
  }
  const view = { snapshot, error }
  runtime.view = view
  orca.panels.post('ping.changed', {})
  return view
}

function poll(runtime: Runtime) {
  if (!runtime.pending) runtime.pending = refresh(runtime).finally(() => { runtime.pending = null })
  return runtime.pending
}

export default function activate(orca: OrcaWorkerApi, call?: Transport) {
  const runtime: Runtime = { orca, call: call ?? (async input => transport(input, await orca.settings.get() as Connection)), pending: null, view: { snapshot: null, error: null } }
  orca.panels.handle('ping.view', () => runtime.view)
  orca.panels.handle('ping.refresh', () => poll(runtime))
  orca.panels.handle('ping.action', async input => {
    if (!input || !['start', 'dismiss', 'collect', 'reopen', 'complete', 'snooze', 'unsnooze', 'priority'].includes(input.action) || (input.action !== 'collect' && !/^[a-f0-9]{8}$/.test(input.id ?? ''))) throw new Error('Invalid action')
    if (runtime.pending) await runtime.pending
    runtime.pending = refresh(runtime, input).finally(() => { runtime.pending = null })
    return runtime.pending
  })
  orca.commands.register('ping.open', async () => {
    const settings = await orca.settings.get() as Connection
    const executable = expandHome(settings.orcaExecutable || 'orca')
    let pluginKey = settings.pluginKey
    if (!pluginKey) {
      const result = await new Promise<string>((resolve, reject) => execFile(executable, ['plugin','list','--json'], { env: runtimeEnv(), timeout: 15000 }, (error, stdout) => error ? reject(error) : resolve(stdout)))
      const matches = JSON.parse(result).result.plugins.filter((item: { pluginKey: string }) => item.pluginKey?.endsWith('.ping-inbox'))
      if (matches.length !== 1) throw new Error('Configure pluginKey when multiple inbox copies are installed')
      pluginKey = matches[0].pluginKey
    }
    await new Promise<void>((resolve, reject) => execFile(executable, ['plugin','open',pluginKey!, '--panel','ping-inbox','--json'], { env: runtimeEnv(), timeout: 15000 }, error => error ? reject(error) : resolve()))
  })
  void poll(runtime)
  timer = setInterval(() => { void poll(runtime) }, 60_000)
  timer.unref?.()
}

export function deactivate() { clearInterval(timer) }
