import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import type { Spec, SpecPr, SpecSession, SpecStep, Specs } from './protocol.ts'
import { expandHome, runtimeEnv } from './config.ts'

// gh 와 orca CLI 를 부르는 자리. 테스트는 이 함수를 바꿔 끼운다.
export type Run = (command: string, args: string[]) => string
type Worktree = { worktreeId: string; repo: string; path: string; branch: string; linkedPR: { number: number } | null; agents: { paneKey: string; state: string; conversationName?: string | null; lastAssistantMessage?: string | null; updatedAt?: number }[] }
type Cache = { at: number; open: string[]; checked: string[]; prs: Record<string, SpecPr> }
// path: 패널에 보일 위치 · origin: 이 문서를 담은 세션 워크트리 · key: 레포 문서의 상태 키(repo/상대경로) · changed: 세션 브랜치에서 고친 문서
type Place = { project: string; path: string; origin?: string; key?: string; changed?: boolean; touched?: boolean; origins?: string[] }
type Document = Place & { file: string; title: string; repo?: string; mode: 'off' | 'done' | 'backlog' | 'active' | 'auto'; branches: string[]; refs: string[]; preamble: string; sections: { title: string; content: string; refs: string[] }[]; updatedAt: number }

const execute: Run = (command, args) => execFileSync(command, args, { env: runtimeEnv(), encoding: 'utf8', timeout: 15_000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
const digest = (value: string) => createHash('sha1').update(value).digest('hex').slice(0, 8)
// 호출은 orca 1번·gh 검색 1번·graphql 최대 2번. 15초씩이면 SSH 제한(worker.ts 100초) 안에 끝난다.
// 매 분 폴링하는 두 맥이 GitHub 를 두드리지 않게 PR 상태는 이만큼 재사용한다.
const ttl = 180_000
const limits = { specs: 12, backlog: 30, prs: 60, content: 60_000, repoFiles: 300 }
const name = /^[\w.-]{1,100}$/
const sessionPrefix = 'structured-agent-session-'
// Orca 워크트리는 레포 이름만 안다. owner/repo#N 을 repo#N 으로 줄여 맞춘다.
const short = (ref: string) => ref.split('/')[1]
// 레포 문서는 체크아웃 경로가 바뀌어도 같은 id 가 되도록 상태 키로 만든다.
const idOf = (doc: Document) => digest(doc.key ?? doc.file)
const rank = (doc: Document) => (doc.changed ? 2 : 0) + (doc.origin ? 1 : 0)

function refsIn(text: string, repo?: string) {
  const urls = [...text.matchAll(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g)].map(match => `${match[1]}#${match[2]}`)
  const short = [...text.matchAll(/(?<![\w/.-])([\w.-]+\/[\w.-]+)#(\d+)\b/g)].map(match => `${match[1]}#${match[2]}`)
  // 맨 #N 은 이슈·규칙 번호와 겹친다. 문서가 repo 를 밝혔을 때 "PR #N" 꼴만 받는다.
  const bare = repo ? [...text.matchAll(/PR\s*#(\d+)\b/g)].map(match => `${repo}#${match[1]}`) : []
  return [...new Set([...urls, ...short, ...bare])].filter(ref => ref.split('/').every(part => name.test(part.split('#')[0])))
}

function parse(file: string, place: Place, overrides: Record<string, string>): Document {
  // 윈도우에서 저장한 문서도 같은 규칙으로 읽는다.
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text)
  const field = (key: string) => front?.[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1].trim().replace(/^["']|["']$/g, '')
  // 레포 문서는 팀 파일이라 frontmatter 를 고치지 않는다. 패널에서 바꾼 상태는 상태 파일이 덮는다.
  const spec = (place.key && overrides[place.key]) || field('spec')
  const declared = field('repo')
  const repo = declared && /^[\w.-]+\/[\w.-]+$/.test(declared) ? declared : undefined
  const body = front ? text.slice(front[0].length) : text
  const [preamble, ...rest] = body.split(/^## /m)
  const sections = rest.map(chunk => {
    const [title, ...lines] = chunk.split('\n')
    const content = lines.join('\n').trim()
    return { title: title.trim(), content, refs: refsIn(content, repo) }
  })
  const refs = [...new Set([...refsIn(preamble, repo), ...sections.flatMap(section => section.refs)])]
  return { ...place, file, repo, title: /^# (.+)$/m.exec(preamble)?.[1].trim() ?? file.split('/').at(-1)!.replace(/\.md$/, ''),
    mode: spec === 'active' || spec === 'done' || spec === 'off' || spec === 'backlog' ? spec : 'auto', branches: (field('branch') ?? '').split(',').map(item => item.trim()).filter(Boolean),
    refs, preamble: preamble.replace(/^# .+\n/m, '').trim(), sections, updatedAt: statSync(file).mtimeMs }
}

// 레포의 문서 폴더(기본 docs/)는 세 단계까지, 레포당 파일 수 상한까지만 본다.
function markdownUnder(folder: string, depth = 0): string[] {
  if (depth > 3 || !existsSync(folder)) return []
  return readdirSync(folder, { withFileTypes: true }).filter(item => !item.name.startsWith('.') && item.name !== '_archive' && item.name !== 'node_modules')
    .flatMap(item => item.isDirectory() ? markdownUnder(join(folder, item.name), depth + 1) : item.name.endsWith('.md') ? [join(folder, item.name)] : [])
}

// 세션 브랜치가 고친 문서. 기준 브랜치를 못 찾아도 미커밋 변경은 따로 본다. -z 로 한글 경로 인용을 피한다.
function changedDocs(root: string, folders: string[], run: Run) {
  const git = (args: string[]) => run('git', ['-C', root, '-c', 'core.quotePath=false', ...args])
  let committed: string[] = []
  for (const base of ['origin/HEAD', 'origin/main', 'origin/master']) {
    try { committed = git(['diff', '--name-only', '-z', `${base}...HEAD`, '--', ...folders]).split('\0'); break } catch { /* 다음 기준 브랜치 */ }
  }
  let pending: string[] = []
  try {
    // 이름 변경 항목은 다음 칸에 옛 경로가 온다. 새 경로만 받는다.
    const entries = git(['status', '--porcelain', '-z', '--untracked-files=all', '--', ...folders]).split('\0')
    pending = entries.flatMap((entry, index) => entry.length > 3 && !/^[RC]/.test(entries[index - 1] ?? '') ? [entry.slice(3)] : [])
  } catch { /* 미커밋 변경을 못 읽어도 커밋된 변경은 쓴다. */ }
  return new Set([...committed, ...pending].map(line => line.trim()).filter(Boolean))
}

function repoDocuments(root: string, repo: string, folders: string[], overrides: Record<string, string>, run: Run, origin?: string) {
  const changed = origin ? changedDocs(root, folders, run) : new Set<string>()
  return folders.flatMap(folder => markdownUnder(join(root, folder))).slice(0, limits.repoFiles).map(file => {
    const path = relative(root, file)
    // 브랜치에서 고쳤다는 것만으로는 명세인지 모른다(결정 기록·가이드도 고친다). 경로에 spec·plan 이 든 문서만 자동 감지 신호로 쓴다.
    return parse(file, { project: repo, path: `${repo}/${path}`, origin, key: `${repo}/${path}`, touched: changed.has(path), changed: changed.has(path) && /(^|\/)(specs?|plans?)(\/|[-_.])/i.test(path) }, overrides)
  })
}

function prQuery(refs: string[]) {
  return 'query{' + refs.map((ref, index) => {
    const [repository, number] = ref.split('#')
    const [owner, repo] = repository.split('/')
    // 이슈 번호가 섞여도 질의 전체가 실패하지 않게 issueOrPullRequest 로 묻고 PR 만 받는다.
    return `p${index}:repository(owner:"${owner}",name:"${repo}"){pullRequest:issueOrPullRequest(number:${Number(number)}){... on PullRequest{url title state isDraft reviewDecision headRefName commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}`
  }).join(' ') + '}'
}

type RawPr = { url: string; title: string; state: string; isDraft: boolean; reviewDecision: string | null; headRefName: string; commits: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] } }
function toPr(ref: string, raw: RawPr): SpecPr {
  const check = raw.commits.nodes[0]?.commit.statusCheckRollup?.state
  return { ref, url: raw.url, title: raw.title, branch: raw.headRefName,
    state: raw.state === 'MERGED' ? 'merged' : raw.state === 'CLOSED' ? 'closed' : raw.isDraft ? 'draft' : 'open',
    review: raw.reviewDecision === 'APPROVED' ? 'approved' : raw.reviewDecision === 'CHANGES_REQUESTED' ? 'changes' : raw.reviewDecision === 'REVIEW_REQUIRED' ? 'pending' : null,
    checks: check === 'SUCCESS' ? 'pass' : check === 'FAILURE' || check === 'ERROR' ? 'fail' : check ? 'pending' : null }
}

// reuse 를 넘기면 열린 PR 검색을 다시 하지 않고 그 목록을 쓴다.
function github(state: string, refs: string[], run: Run, now: number, reuse?: string[]): { cache: Cache; error?: string } {
  const file = join(state, 'spec-cache.json')
  let cache: Cache = { at: 0, open: [], checked: [], prs: {} }
  try { if (existsSync(file)) cache = { ...cache, ...JSON.parse(readFileSync(file, 'utf8')) } } catch { /* 캐시는 다시 만든다. */ }
  const missing = refs.filter(ref => !cache.checked.includes(ref))
  if (cache.at && now - cache.at < ttl && !missing.length) return { cache }
  try {
    const open = reuse ?? (JSON.parse(run('gh', ['search', 'prs', '--author=@me', '--state=open', '--limit=100', '--json', 'repository,number'])) as { number: number; repository: { nameWithOwner: string } }[])
      .map(item => `${item.repository.nameWithOwner}#${item.number}`)
    const wanted = [...new Set([...refs, ...open])].slice(0, limits.prs)
    const data = wanted.length ? (JSON.parse(run('gh', ['api', 'graphql', '-f', 'query=' + prQuery(wanted)])) as { data: Record<string, { pullRequest: RawPr | null } | null> }).data : {}
    const prs = Object.fromEntries(wanted.flatMap((ref, index) => data[`p${index}`]?.pullRequest?.url ? [[ref, toPr(ref, data[`p${index}`]!.pullRequest!)]] : []))
    cache = { at: now, open, checked: wanted, prs }
    writeFileSync(file + '.tmp', JSON.stringify(cache), { mode: 0o600 }); renameSync(file + '.tmp', file)
    return { cache }
  } catch (error) {
    // gh 가 실패해도 마지막으로 받은 상태를 보여 준다. 오래된 값이라고 표시만 한다.
    return { cache, error: 'GitHub status is stale: ' + String((error as { stderr?: string }).stderr || error).trim().split('\n').at(-1) }
  }
}

function sessionsOf(doc: Document, prs: SpecPr[], worktrees: Worktree[]): SpecSession[] {
  // 브랜치 이름은 레포마다 겹친다(feat/a). 레포 이름과 함께 맞춘다. frontmatter branch 는 문서의 repo·PR 레포로 좁히고, 둘 다 없을 때만 이름으로 맞춘다.
  const repos = doc.repo ? [doc.repo.split('/')[1]] : doc.key ? [doc.project] : [...new Set(doc.refs.map(ref => ref.split('/')[1].split('#')[0]))]
  const branches = new Set([...doc.branches.flatMap(branch => (repos.length ? repos : ['*']).map(repo => `${repo}:refs/heads/${branch}`)), ...prs.map(pr => `${pr.ref.split('/')[1].split('#')[0]}:refs/heads/${pr.branch}`)])
  const linked = new Set(prs.map(pr => short(pr.ref)))
  // 워크트리에 문서가 있다는 것만으로는 그 세션의 일이 아니다. 그 브랜치에서 문서를 고쳤을 때만 붙인다.
  return worktrees.filter(item => (doc.origins ?? (doc.touched && doc.origin ? [doc.origin] : [])).includes(item.path) || branches.has(`${item.repo}:${item.branch}`) || branches.has(`*:${item.branch}`) || (item.linkedPR && linked.has(`${item.repo}#${item.linkedPR.number}`))).flatMap(sessionsIn).sort((a, b) => b.updatedAt - a.updatedAt)
}

// 구조화 세션은 그 대화로, 아니면 워크트리를 연다. 새 대화를 만들지 않는다.
function sessionsIn(item: Worktree): SpecSession[] {
  const place = { worktree: item.path, repo: item.repo, branch: item.branch.replace(/^refs\/heads\//, '') }
  const structured = item.agents.filter(agent => agent.paneKey.startsWith(sessionPrefix))
  if (!structured.length) return [{ ...place, key: 'worktree:' + item.worktreeId, title: item.path.split('/').at(-1) ?? item.repo, state: item.agents[0]?.state ?? 'idle', updatedAt: item.agents[0]?.updatedAt ?? 0 }]
  return structured.map(agent => ({ ...place, key: agent.paneKey.slice(sessionPrefix.length).split(':')[0], title: agent.conversationName || item.path.split('/').at(-1) || item.repo,
    state: agent.state, updatedAt: agent.updatedAt ?? 0, last: agent.lastAssistantMessage?.replace(/\s+/g, ' ').slice(0, 120) || undefined }))
}

function stepOf(section: Document['sections'][number], prs: Record<string, SpecPr>, checked: Set<string>): SpecStep {
  // 조회했는데 PR 이 아닌 번호(이슈 등)는 빼고, 아직 조회 못 한 번호는 상태 불명으로 남긴다.
  const refs = section.refs.filter(ref => prs[ref] || !checked.has(ref))
  const linked = refs.flatMap(ref => prs[ref] ?? [])
  const boxes = [...section.content.matchAll(/^\s*[-*] \[( |x|X)\]/gm)]
  const done = boxes.filter(box => box[1] !== ' ').length
  // 조회하지 못한 PR 이 하나라도 있으면 완료로 확정하지 않는다.
  const complete = linked.length === refs.length
  const status = linked.length ? (complete && linked.every(pr => pr.state === 'merged' || pr.state === 'closed') && linked.some(pr => pr.state === 'merged') ? 'done' : linked.some(pr => pr.state !== 'closed') ? 'active' : 'todo')
    : refs.length ? 'todo' : boxes.length && done === boxes.length ? 'done' : done > 0 ? 'active' : 'todo'
  return { title: section.title, content: section.content, prs: linked, done, total: boxes.length, status }
}

// config.json 의 specs. roots 는 내가 쓰는 명세 폴더(그 아래 .md 전부), repos 는 docs 폴더를 볼 레포 체크아웃이다.
export type SpecOptions = { enabled: boolean; roots: string[]; repos: string[]; docs: string[]; orca: string }
// 문서 목록 한 벌. 진행 목록과 상태 변경이 같은 목록에서 id 를 찾는다.
function catalog(options: SpecOptions, state: string, run: Run) {
  if (!options.enabled) return undefined
  const existing = (paths: string[]) => paths.map(path => expandHome(path)).filter(path => isAbsolute(path) && existsSync(path))
  const statusFile = join(state, 'spec-status.json')
  const overrides = existsSync(statusFile) ? JSON.parse(readFileSync(statusFile, 'utf8')) as Record<string, string> : {}
  let worktrees: Worktree[] = []
  let error: string | undefined
  try { worktrees = (JSON.parse(run(options.orca, ['worktree', 'ps', '--limit', '200', '--json'])) as { result: { worktrees: Worktree[] } }).result.worktrees.filter(item => item.agents.length) }
  catch { error = 'Orca sessions are unavailable' }
  const repoDocs = [...worktrees.flatMap(item => repoDocuments(item.path, item.repo, options.docs, overrides, run, item.path)),
    ...existing(options.repos).flatMap(root => repoDocuments(root, root.split('/').at(-1)!, options.docs, overrides, run))]
  // 같은 레포 문서가 여러 체크아웃에 있으면 세션 브랜치에서 고친 것 > 세션 워크트리 > 기본 체크아웃 순으로 하나만 남긴다.
  // 본문은 대표 사본 하나만 쓰되, 그 문서를 고친 워크트리는 모두 남겨 각 세션을 붙인다.
  const unique = [...new Map([...repoDocs].sort((a, b) => rank(a) - rank(b)).map(doc => [doc.key!, doc])).values()]
    .map(doc => ({ ...doc, origins: repoDocs.filter(item => item.key === doc.key && item.touched && item.origin).map(item => item.origin!) }))
  const own = existing(options.roots).flatMap(root => markdownUnder(root).slice(0, limits.repoFiles).map(file => {
    const label = root.split('/').at(-1)!
    return parse(file, { project: label, path: `${label}/${relative(root, file)}` }, {})
  }))
  return { statusFile, overrides, docs: [...own, ...unique], worktrees, error }
}

// 패널의 백로그·다시 진행. 내 명세 폴더 문서는 frontmatter 의 spec 한 줄만 바꾼다(편집기에서도 보인다).
// 레포 문서는 팀이 공유하는 파일이라 고치지 않고 상태 파일에 남긴다.
export function setSpecStatus(options: SpecOptions, state: string, id: string, status: 'backlog' | 'active' | 'done', run: Run = execute) {
  const found = catalog(options, state, run)
  if (!found) throw new Error('Spec tracking is not enabled')
  const doc = found.docs.find(item => idOf(item) === id)
  if (!doc) throw new Error('Spec document is no longer available; refresh first')
  if (doc.key) {
    const file = found.statusFile
    writeFileSync(file + '.tmp', JSON.stringify({ ...found.overrides, [doc.key]: status }), { mode: 0o600 }); renameSync(file + '.tmp', file)
    return
  }
  const text = readFileSync(doc.file, 'utf8')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)
  const updated = !front ? `---${eol}spec: ${status}${eol}---${eol}${text}`
    : /^spec:.*$/m.test(front[1]) ? front[0].replace(/^spec:.*?(?=\r?$)/m, `spec: ${status}`) + text.slice(front[0].length)
    : front[0].replace(/^---\r?\n/, `---${eol}spec: ${status}${eol}`) + text.slice(front[0].length)
  writeFileSync(doc.file + '.spec.tmp', updated); renameSync(doc.file + '.spec.tmp', doc.file)
}

// 진행 목록에서 내린 명세(백로그·완료). 최근에 고친 것부터 상한까지만 보인다.
function shelf(docs: Document[], mode: Document['mode']) {
  return docs.filter(doc => doc.mode === mode).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limits.backlog)
    .map(doc => ({ id: idOf(doc), title: doc.title, project: doc.project, path: doc.path }))
}

export function specs(options: SpecOptions, state: string, run: Run = execute, now = Date.now()): Specs | undefined {
  const found = catalog(options, state, run)
  if (!found) return undefined
  const { docs, worktrees, error } = found
  const backlog = shelf(docs, 'backlog')
  const done = shelf(docs, 'done')
  const all = docs.filter(doc => doc.mode === 'active' || doc.mode === 'auto')
  const live = new Set(worktrees.flatMap(item => item.linkedPR ? [`${item.repo}#${item.linkedPR.number}`] : []))
  // 열린 PR 목록은 gh 가 같이 가져오므로, 미리 아는 후보(표시한 명세·세션이 붙은 명세)의 PR 만 넘긴다.
  const known = all.filter(doc => doc.mode === 'active' || doc.changed || doc.refs.some(ref => live.has(short(ref))))
  const fetched = github(state, [...new Set(known.flatMap(doc => doc.refs))].slice(0, limits.prs), run, now)
  const open = new Set(fetched.cache.open)
  // 자동 감지: 표시가 없어도 내 열린 PR 이나 세션이 붙은 PR 을 가리키거나, 세션 브랜치에서 고친 레포 문서를 잡는다.
  const chosen = all.filter(doc => doc.mode === 'active' || doc.changed || doc.refs.some(ref => open.has(ref) || live.has(short(ref))))
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limits.specs)
  // 자동 감지로 고른 문서의 지난 PR(머지·닫힘)은 첫 조회에 없다. 고른 뒤 빠진 것만 다시 묻는다.
  const settled = github(state, [...new Set([...known, ...chosen].flatMap(doc => doc.refs))].slice(0, limits.prs), run, now, fetched.cache.open)
  const { prs } = settled.cache
  const checked = new Set(settled.cache.checked)
  let budget = limits.content
  const items: Spec[] = chosen.map(doc => {
    const steps = doc.sections.filter(section => section.refs.length || /^\s*[-*] \[[ xX]\]/m.test(section.content)).map(section => stepOf(section, prs, checked))
    const linked = doc.refs.flatMap(ref => prs[ref] ?? [])
    const summary = doc.preamble.slice(0, Math.max(0, budget))
    budget -= summary.length
    const trimmed = steps.map(step => {
      const content = step.content.slice(0, Math.max(0, budget))
      budget -= content.length
      return { ...step, content }
    })
    return { id: idOf(doc), title: doc.title, project: doc.project, path: doc.path, mode: doc.mode === 'active' ? 'marked' : 'auto', updatedAt: doc.updatedAt,
      summary, prs: linked, steps: trimmed, current: steps.findIndex(step => step.status !== 'done'), sessions: sessionsOf(doc, linked, worktrees) }
  })
  // 명세에 안 붙은 활동 세션도 보여 준다. 명세를 쓰기 전 단계의 일도 한곳에서 찾게 한다.
  const linkedKeys = new Set(items.flatMap(item => item.sessions.map(session => session.key)))
  const loose = worktrees.flatMap(sessionsIn).filter(session => !linkedKeys.has(session.key)).sort((a, b) => b.updatedAt - a.updatedAt)
  return { items, backlog, done, sessions: loose, checkedAt: settled.cache.at || now, error: error ?? settled.error ?? fetched.error }
}
