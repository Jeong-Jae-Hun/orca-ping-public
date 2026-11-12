import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, statSync, writeFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { addDays, addHours, set, fromZonedTime, toZonedTime } from '../vendor/date.js'
import { collectionStatus, requestCollection } from './collect.ts'
import { sourceHealth } from './health.ts'
import { theory } from './theory.ts'
import { setSpecStatus, specs, type Run as SpecRun, type SpecOptions } from './spec.ts'
import { revealSession, type RevealedSession } from './session.ts'
import { config, defaultState, runtimeEnv, expandHome } from './config.ts'
import { parseArgs } from 'node:util'
import type { Judgment, Priority, Request, SavedTask, Snapshot } from './protocol.ts'

type Run = (args: string[], executable?: string) => unknown
// 이전 버전의 전체 실행 영수증도 읽되, 새 기록에는 복원에 필요한 식별자만 저장한다.
type Launch = { ok?: boolean; result?: { worktree?: { id?: string; path?: string }; launch?: { outcome?: { sessionId?: string } } } }
type Record = { title: string; repo?: string; url?: string; summary?: string; status?: 'started' | 'dismissed' | 'uncertain' | 'snoozed' | 'completed'; priority?: Priority; until?: number; startedAt?: number; sessionId?: string; worktreeId?: string; worktreePath?: string; lastOpenedAt?: number; result?: Launch }
const digest = (value: string) => createHash('sha1').update(value).digest('hex').slice(0, 8)
const read = (file: string) => existsSync(file) ? readFileSync(file, 'utf8') : ''
const atomic = (file: string, value: unknown) => { writeFileSync(file + '.tmp', JSON.stringify(value), { mode: 0o600 }); renameSync(file + '.tmp', file) }
const execute: Run = (args, executable = 'orca') => JSON.parse(execFileSync(executable, args, { env: runtimeEnv(), encoding: 'utf8', timeout: 90_000, maxBuffer: 2 * 1024 * 1024 }))
const grades = ['urgent', 'today', 'info', 'unknown']

export function snoozeUntil(preset: 'hour' | 'tomorrow', now: number, zone = 'Asia/Seoul') {
  return preset === 'hour' ? addHours(now, 1).getTime() : fromZonedTime(set(addDays(toZonedTime(now, zone), 1), { hours: 9, minutes: 0, seconds: 0, milliseconds: 0 }), zone).getTime()
}

function judgmentId(item: Judgment, proposals: { id: string; title: string; url: string }[]) {
  return proposals.find(proposal => proposal.title === item.title || (item.url && proposal.url === item.url))?.id ?? digest(item.title)
}

function hidden(record: Record | undefined, now: number) {
  return record?.status === 'dismissed' || record?.status === 'started' || record?.status === 'completed' || (record?.status === 'snoozed' && (record.until ?? Infinity) > now)
}

function savedTask(id: string, record: Record): SavedTask | undefined {
  if (record.status !== 'started' && record.status !== 'completed') return undefined
  if (record.status === 'completed' && !record.sessionId && !record.result?.result?.launch?.outcome?.sessionId) return undefined
  return { id, title: record.title, repo: record.repo ?? '~', url: record.url ?? '',
    worktreeId: record.worktreeId ?? record.result?.result?.worktree?.id ?? '',
    worktreePath: record.worktreePath ?? record.result?.result?.worktree?.path ?? '',
    sessionId: record.sessionId ?? record.result?.result?.launch?.outcome?.sessionId ?? '',
    startedAt: record.startedAt ?? 0, completed: record.status === 'completed', phase: 'unknown' }
}

export function bridge(input: Request, state = defaultState(), home = homedir(), run = execute,
  reveal: (id: string) => RevealedSession = revealSession, now = Date.now(), specRun?: SpecRun): Snapshot {
  if (!input || !['snapshot', 'start', 'dismiss', 'collect', 'reopen', 'complete', 'snooze', 'unsnooze', 'priority', 'theory-read', 'theory-note', 'theory-next', 'theory-preferences', 'theory-explain', 'spec-open', 'spec-status', 'session-open'].includes(input.action)) throw new Error('Invalid action')
  const settings = config(state)
  const rows = read(join(state, 'proposals.md')).split('\n').filter(line => line.split(' | ').length >= 5)
  const proposals = rows.map(row => {
    const [title, repo, url, summary, instructions] = row.split(' | ')
    return { id: digest(title), title, repo, url: /^https:\/\//.test(url) ? url : '', summary, instructions, row }
  })
  const reportPath = join(state, 'report.md')
  const report = read(reportPath)
  const briefing = JSON.parse(read(join(state, 'briefing.json')) || '{}') as { batch?: string; items?: Judgment[] }
  const judgments = briefing.batch === digest(report) && Array.isArray(briefing.items) ? briefing.items : undefined
  const actions = join(state, 'panel-actions')
  mkdirSync(actions, { recursive: true, mode: 0o700 })
  if (input.action === 'collect') requestCollection(state, home)
  if (input.action !== 'snapshot' && input.action !== 'collect' && !input.action.startsWith('theory-') && !input.action.startsWith('spec-') && input.action !== 'session-open') {
    if (typeof input.id !== 'string' || !/^[a-f0-9]{8}$/.test(input.id)) throw new Error('Invalid proposal ID')
    if (input.action === 'priority' && input.priority !== 'auto' && !grades.includes(input.priority ?? '')) throw new Error('Invalid priority')
    if (input.action === 'snooze' && !['hour', 'tomorrow'].includes(input.preset ?? '')) throw new Error('Invalid reminder preset')
    const receipt = join(actions, input.id + '.json')
    const lock = join(actions, input.id + '.lock')
    try { mkdirSync(lock) } catch { throw new Error('Task is already being handled') }
    try {
      const previous: Record | undefined = existsSync(receipt) ? JSON.parse(read(receipt)) : undefined
      const proposal = proposals.find(item => item.id === input.id)
      const judgment = judgments?.find(item => judgmentId(item, proposals) === input.id)
      const title = proposal?.title ?? previous?.title ?? judgment?.title
      if (!title || digest(title) !== input.id) throw new Error('Task no longer exists; refresh first')
      const record: Record = { title, repo: proposal?.repo, url: proposal?.url ?? judgment?.url, summary: proposal?.summary ?? judgment?.reason, ...previous }
      if (input.action === 'priority') {
        if (input.priority === 'auto') delete record.priority
        else record.priority = input.priority as Priority
      } else if (input.action === 'reopen') {
        const task = savedTask(input.id, record)
        if (!task?.sessionId || !task.worktreeId) throw new Error('Saved chat identity is unavailable')
        const result = reveal === revealSession ? revealSession(task.sessionId, settings.runtimeMetadataPath ? expandHome(settings.runtimeMetadataPath, home) : undefined) : reveal(task.sessionId)
        if (result.sessionId !== task.sessionId || result.workspaceId !== task.worktreeId) throw new Error('Saved chat workspace mismatch')
        record.lastOpenedAt = now
      } else if (input.action === 'complete') {
        record.status = 'completed'
        delete record.until
      } else if (input.action === 'unsnooze') {
        if (record.status !== 'snoozed') throw new Error('Task is not snoozed')
        if (!proposal && !judgment) throw new Error('Original task is unavailable; review its source link or mark it complete')
        delete record.status
        delete record.until
      } else if (input.action === 'snooze') {
        if (record.status && record.status !== 'snoozed') throw new Error('Task has already been handled')
        record.status = 'snoozed'
        record.until = snoozeUntil(input.preset!, now, settings.timeZone)
      } else if (input.action === 'dismiss') {
        if (record.status === 'started' || record.status === 'uncertain') throw new Error('Active or uncertain tasks must be reviewed first')
        record.status = 'dismissed'
      } else {
        if (record.status && !(record.status === 'snoozed' && (record.until ?? Infinity) <= now)) throw new Error('Task already handled or launch uncertain; refresh first')
        if (!proposal) throw new Error('Task proposal is no longer available')
        const { repo, summary, instructions } = proposal
        if (repo === '~' || !(repo.startsWith('~/') || repo.startsWith('/'))) throw new Error('Proposal needs a Git repository')
        const path = resolve(repo.startsWith('~/') ? join(home, repo.slice(2)) : repo)
        if (!existsSync(path)) throw new Error('Repository path is unavailable')
        const root = execFileSync('git', ['-C', path, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 5000 }).trim()
        if (realpathSync(root) !== realpathSync(path)) throw new Error('Proposal must point to a repository root')
        const prompt = read(join(state, 'prompts', input.id + '.md')) || summary + '\n\n' + instructions
        record.status = 'uncertain'
        atomic(receipt, record)
        const result = run(['worktree', 'create', '--repo', 'path:' + path, '--parent-worktree', 'path:' + path,
          '--name', title.replace(/[^a-zA-Z0-9가-힣]+/g, '-').slice(0, 40) + '-' + input.id, '--comment', title, '--branch', 'feat/ping-' + input.id, '--agent', settings.agent, '--surface', 'chat',
          '--prompt', '사용자 지시: 해당 프로젝트에서 새로 만든 작업 전용 워크트리입니다. 이 워크트리에서 작업하세요.\n\n' + prompt, '--activate', '--json'], settings.orcaExecutable) as Launch
        if (!result?.ok || !result.result?.worktree?.id || !result.result.worktree.path || !result.result.launch?.outcome?.sessionId) throw new Error('Restorable chat launch was not acknowledged; inspect Orca before retrying')
        record.status = 'started'
        record.worktreeId = result.result.worktree.id
        record.worktreePath = result.result.worktree.path
        record.sessionId = result.result.launch.outcome.sessionId
        record.startedAt = now
        delete record.until
      }
      atomic(receipt, record)
      const tab = proposal?.row.match(/ \| tab:(\S+)/)?.[1]
      if (tab && (input.action === 'start' || input.action === 'dismiss')) {
        try { run(['terminal', 'close', '--terminal', tab, '--tab', '--json'], settings.orcaExecutable) } catch { /* 저장한 대화는 재실행하지 않는다. */ }
      }
    } finally { rmdirSync(lock) }
  }
  const records = new Map(readdirSync(actions).filter(file => /^[a-f0-9]{8}\.json$/.test(file)).map(file => {
    const record: Record = JSON.parse(read(join(actions, file)))
    if (digest(record.title) !== file.slice(0, 8)) throw new Error('Saved task identity mismatch')
    return [file.slice(0, 8), record] as const
  }))
  const tasks = [...records].flatMap(([id, record]) => savedTask(id, record) ?? [])
  if (tasks.some(task => task.worktreeId && task.sessionId)) {
    try {
      const result = run(['worktree', 'ps', '--limit', '200', '--json'], settings.orcaExecutable) as { ok: boolean; result: { truncated: boolean; worktrees: { worktreeId: string; agents: { paneKey: string; state: string; mainAgent?: { state: string } }[] }[] } }
      if (!result.ok || !Array.isArray(result.result?.worktrees)) throw new Error('Task status is unavailable')
      for (const task of tasks) {
        const workspace = result.result.worktrees.find(item => item.worktreeId === task.worktreeId)
        const agent = workspace?.agents.find(item => item.paneKey.startsWith('structured-agent-session-' + task.sessionId + ':'))
        const phase = agent?.state ?? agent?.mainAgent?.state
        task.phase = phase && ['working', 'waiting', 'blocked', 'done'].includes(phase) ? phase as SavedTask['phase'] : workspace && !agent && !result.result.truncated ? 'closed' : 'unknown'
      }
    } catch { /* 상태 조회 실패로 저장한 세션을 버리지 않는다. */ }
  }
  const reminders = [...records].flatMap(([id, record]) => record.status === 'snoozed' && record.until ? [{ id, title: record.title, url: record.url ?? '', until: record.until }] : [])
  const specOptions: SpecOptions = { ...settings.specs, orca: settings.orcaExecutable }
  if (input.action === 'spec-status') {
    if (typeof input.id !== 'string' || !/^[a-f0-9]{8}$/.test(input.id) || (input.text !== 'backlog' && input.text !== 'active')) throw new Error('Invalid spec status')
    setSpecStatus(specOptions, state, input.id, input.text, specRun)
  }
  let tracking: Snapshot['specs']
  try { tracking = specs(specOptions, state, specRun, now) }
  catch (error) { tracking = { items: [], backlog: [], sessions: [], checkedAt: now, error: 'Specs could not be read: ' + (error instanceof Error ? error.message : String(error)) } }
  if (input.action === 'spec-open' || input.action === 'session-open') {
    // 패널이 보낸 키는 지금 계산한 명세의 세션이나 활동 세션일 때만 연다. 임의 세션·워크트리는 열지 않는다.
    const session = input.action === 'spec-open' ? tracking?.items.find(item => item.id === input.id)?.sessions.find(item => item.key === input.key)
      : tracking?.sessions.find(item => item.key === input.key)
    if (!session) throw new Error('Spec session is no longer linked; refresh first')
    if (session.key.startsWith('worktree:')) run(['worktree', 'activate', '--worktree', 'id:' + session.key.slice('worktree:'.length), '--json'], settings.orcaExecutable)
    else {
      const result = reveal === revealSession ? revealSession(session.key, settings.runtimeMetadataPath ? expandHome(settings.runtimeMetadataPath, home) : undefined) : reveal(session.key)
      if (result.sessionId !== session.key) throw new Error('Spec session identity mismatch')
    }
  }
  let learning: Snapshot['theory']
  try { learning = theory(input, state, settings.learning) }
  catch (error) {
    if (input.action.startsWith('theory-')) throw error
    learning = { history: [], remaining: 0, error: 'Learning data could not be read; check the data directory' }
  }
  return {
    specs: tracking,
    theory: learning,
    timeZone: settings.timeZone, collectionAvailable: settings.collectorCommand.length > 0, collection: collectionStatus(state), savedTasks: tasks,
    snoozed: reminders.filter(item => item.until > now), reminders: reminders.filter(item => item.until <= now),
    sourceHealth: sourceHealth(state, now),
    judgments: judgments?.filter(item => !hidden(records.get(judgmentId(item, proposals)), now)).map(item => {
      const id = judgmentId(item, proposals)
      const override = records.get(id)?.priority
      return { ...item, id, priority: override ?? item.priority, manualPriority: override !== undefined }
    }),
    batch: digest(report), report, updatedAt: existsSync(reportPath) ? statSync(reportPath).mtimeMs : 0,
    proposals: proposals.filter(item => !hidden(records.get(item.id), now)).map(({ id, title, repo, url, summary }) => ({
      id, title, repo, url, summary, priority: records.get(id)?.priority, manualPriority: records.get(id)?.priority !== undefined,
      status: records.get(id)?.status === 'uncertain' ? 'uncertain' : 'waiting',
    })),
  }
}

if (process.argv[1] && existsSync(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const input = readFileSync(0, 'utf8')
    if (input.length > 2048) throw new Error('Request is too large')
    const { values } = parseArgs({ options: { state: { type: 'string' } } })
    console.log(JSON.stringify(bridge(JSON.parse(input), values.state ? expandHome(values.state) : defaultState())))
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
}
