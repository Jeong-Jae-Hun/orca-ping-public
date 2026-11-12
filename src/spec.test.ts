import { assert, test } from 'orca/testing'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setSpecStatus, specs, type Run, type SpecOptions } from './spec.ts'

const pr = (state: string, extra: object = {}) => ({ url: 'https://github.com/o/r/pull/1', title: 'PR', state, isDraft: false, reviewDecision: null, headRefName: 'feat/a', commits: { nodes: [] }, ...extra })
const worktree = { worktreeId: 'repo::/w/a', repo: 'r', path: '/w/a', branch: 'refs/heads/feat/b', linkedPR: null,
  agents: [{ paneKey: 'structured-agent-session-claude_1:pane', state: 'working', conversationName: '구현 중', updatedAt: 5 }] }

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ping-spec-'))
  const vault = join(root, 'vault'); const state = join(root, 'state')
  mkdirSync(join(vault, 'notes/plans'), { recursive: true }); mkdirSync(join(vault, 'notes/plans/_archive'), { recursive: true }); mkdirSync(state)
  const options: SpecOptions = { enabled: true, roots: [vault], repos: [], docs: ['docs'], orca: 'orca' }
  const write = (name: string, body: string) => writeFileSync(join(vault, 'notes/plans', name), body)
  return { root, vault, state, options, write, close: () => rmSync(root, { recursive: true, force: true }) }
}

// gh·orca 호출을 기록하고 정해진 응답을 돌려준다.
function runner(prs: Record<string, object | null>, open: string[] = [], worktrees: object[] = []) {
  const calls: string[][] = []
  const run: Run = (command, args) => {
    calls.push([command, ...args])
    if (command === 'orca') return JSON.stringify({ result: { worktrees } })
    if (args[0] === 'search') return JSON.stringify(open.map(ref => ({ number: Number(ref.split('#')[1]), repository: { nameWithOwner: ref.split('#')[0] } })))
    const query = args.at(-1)!
    const refs = [...query.matchAll(/p(\d+):repository\(owner:"([^"]+)",name:"([^"]+)"\)\{pullRequest:issueOrPullRequest\(number:(\d+)\)/g)]
    return JSON.stringify({ data: Object.fromEntries(refs.map(match => [`p${match[1]}`, { pullRequest: prs[`${match[2]}/${match[3]}#${match[4]}`] ?? null }])) })
  }
  return { run, calls }
}

test('표시한 명세는 소제목을 단계로 나누고 PR 상태로 진행 단계를 정한다', () => {
  const f = fixture()
  try {
    f.write('A.md', '---\nspec: active\n---\n# 결제 대행\n\n요약\n\n## 1. 스키마\n\no/r#1\n\n## 배경\n\n설명만 있는 절\n\n## 2. API\n\n- [x] 계약\n- [ ] 서명\n\n## 3. 배포\n\nhttps://github.com/o/r/pull/2\n')
    const { run } = runner({ 'o/r#1': pr('MERGED'), 'o/r#2': pr('OPEN', { isDraft: true, headRefName: 'feat/b' }) }, [], [worktree])
    const result = specs(f.options, f.state, run, 1000)!
    const [spec] = result.items
    assert.equal(spec.title, '결제 대행')
    assert.equal(spec.mode, 'marked')
    assert.deepEqual(spec.steps.map(step => [step.title, step.status]), [['1. 스키마', 'done'], ['2. API', 'active'], ['3. 배포', 'active']])
    assert.equal(spec.current, 1)
    assert.deepEqual([spec.steps[1].done, spec.steps[1].total], [1, 2])
    assert.equal(spec.steps[2].prs[0].state, 'draft')
    assert.deepEqual(spec.sessions.map(session => session.key), ['claude_1'])
  } finally { f.close() }
})

test('표시가 없어도 내 열린 PR 을 가리키면 자동 감지하고 done·off·archive 는 뺀다', () => {
  const f = fixture()
  try {
    f.write('AUTO.md', '# 자동\n\n## 구현\n\no/r#7\n')
    f.write('OLD.md', '# 무관\n\n## 구현\n\no/r#8\n')
    f.write('DONE.md', '---\nspec: done\n---\n# 끝\n\n## 구현\n\no/r#7\n')
    writeFileSync(join(f.vault, 'notes/plans/_archive/X.md'), '---\nspec: active\n---\n# 보관\n')
    const { run } = runner({ 'o/r#7': pr('OPEN'), 'o/r#8': pr('MERGED') }, ['o/r#7'])
    const result = specs(f.options, f.state, run, 1000)!
    assert.deepEqual(result.items.map(item => [item.title, item.mode]), [['자동', 'auto']])
  } finally { f.close() }
})

test('세션이 붙은 PR 을 가리키는 명세도 자동 감지한다', () => {
  const f = fixture()
  try {
    f.write('LIVE.md', '# 세션\n\n## 구현\n\no/r#9\n')
    const { run } = runner({ 'o/r#9': pr('OPEN', { headRefName: 'other' }) }, [], [{ ...worktree, linkedPR: { number: 9 } }])
    const [spec] = specs(f.options, f.state, run, 1000)!.items
    assert.equal(spec.title, '세션')
    assert.deepEqual(spec.sessions.map(session => session.title), ['구현 중'])
  } finally { f.close() }
})

test('PR 상태는 캐시 기간 동안 다시 묻지 않고 gh 실패 때는 지난 상태를 보인다', () => {
  const f = fixture()
  try {
    f.write('A.md', '---\nspec: active\n---\n# 캐시\n\n## 구현\n\no/r#1\n')
    const first = runner({ 'o/r#1': pr('OPEN') })
    specs(f.options, f.state, first.run, 1000)
    assert.ok(existsSync(join(f.state, 'spec-cache.json')))
    const second = runner({})
    specs(f.options, f.state, second.run, 2000)
    assert.equal(second.calls.filter(call => call[0] === 'gh').length, 0)
    const failing: Run = command => { if (command === 'gh') throw new Error('offline'); return JSON.stringify({ result: { worktrees: [] } }) }
    const stale = specs(f.options, f.state, failing, 1000 + 200_000)!
    assert.match(stale.error ?? '', /stale/)
    assert.equal(stale.items[0].steps[0].prs[0].state, 'open')
  } finally { f.close() }
})

test('맨 #N 은 repo 를 밝힌 문서의 PR #N 꼴만 PR 로 본다', () => {
  const f = fixture()
  try {
    f.write('A.md', '---\nspec: active\nrepo: o/r\n---\n# 번호\n\n## 구현\n\nPR #3 을 올린다. 규칙 #4 참고.\n')
    const { run, calls } = runner({ 'o/r#3': pr('OPEN') })
    const [spec] = specs(f.options, f.state, run, 1000)!.items
    assert.deepEqual(spec.steps[0].prs.map(item => item.ref), ['o/r#3'])
    assert.ok(!calls.some(call => call.join(' ').includes('number:4')))
  } finally { f.close() }
})

test('명세 추적을 켜지 않으면 명세를 읽지 않는다', () => {
  const root = mkdtempSync(join(tmpdir(), 'ping-spec-'))
  try { assert.equal(specs({ enabled: false, roots: [], repos: [], docs: ['docs'], orca: 'orca' }, root, () => { throw new Error('Must not run') }), undefined) }
  finally { rmSync(root, { recursive: true, force: true }) }
})

test('리뷰 반례: 다른 레포 같은 브랜치 세션은 붙이지 않는다', () => {
  const f = fixture()
  try {
    f.write('A.md', '---\nspec: active\n---\n# 레포\n\n## 구현\n\no/r#1\n')
    const other = { ...worktree, repo: 'other', branch: 'refs/heads/feat/a', agents: [{ ...worktree.agents[0], paneKey: 'structured-agent-session-wrong:pane' }] }
    const mine = { ...worktree, branch: 'refs/heads/feat/a' }
    const { run } = runner({ 'o/r#1': pr('OPEN') }, [], [other, mine])
    assert.deepEqual(specs(f.options, f.state, run, 1000)!.items[0].sessions.map(session => session.key), ['claude_1'])
  } finally { f.close() }
})

test('리뷰 반례: 자동 감지 문서의 지난 PR 도 조회해 진행 단계를 맞춘다', () => {
  const f = fixture()
  try {
    f.write('A.md', '# 자동\n\n## 1. 앞\n\no/r#1\n\n## 2. 뒤\n\no/r#2\n')
    const { run } = runner({ 'o/r#1': pr('MERGED'), 'o/r#2': pr('OPEN') }, ['o/r#2'])
    const [spec] = specs(f.options, f.state, run, 1000)!.items
    assert.deepEqual(spec.steps.map(step => step.status), ['done', 'active'])
    assert.equal(spec.current, 1)
  } finally { f.close() }
})

test('리뷰 반례: 상태를 모르는 PR 이 섞이면 완료로 확정하지 않고 PR 이 아닌 번호는 무시한다', () => {
  const f = fixture()
  try {
    f.write('A.md', '---\nspec: active\n---\n# 불명\n\n## 1. 둘\n\no/r#1 o/r#2\n\n## 2. 이슈\n\no/r#3\n\n- [x] 끝\n')
    const { run } = runner({ 'o/r#1': pr('MERGED') })
    const steps = specs(f.options, f.state, run, 1000)!.items[0].steps
    assert.deepEqual(steps.map(step => step.status), ['done', 'done'])
    const failing: Run = command => { if (command === 'gh') throw new Error('offline'); return JSON.stringify({ result: { worktrees: [] } }) }
    f.write('B.md', '---\nspec: active\n---\n# 새 PR\n\n## 1. 둘\n\no/r#1 o/r#9\n')
    const fresh = specs(f.options, f.state, failing, 2000)!.items.find(item => item.title === '새 PR')!
    assert.equal(fresh.steps[0].status, 'active')
  } finally { f.close() }
})

test('리뷰 반례: CRLF 문서의 frontmatter 도 읽는다', () => {
  const f = fixture()
  try {
    f.write('A.md', '---\r\nspec: off\r\n---\r\n# 끔\r\n\r\n## 구현\r\n\r\no/r#1\r\n')
    f.write('B.md', '---\r\nspec: active\r\nrepo: o/r\r\n---\r\n# 켬\r\n\r\n## 구현\r\n\r\nPR #2\r\n')
    const { run } = runner({ 'o/r#1': pr('OPEN'), 'o/r#2': pr('OPEN') }, ['o/r#1'])
    const items = specs(f.options, f.state, run, 1000)!.items
    assert.deepEqual(items.map(item => [item.title, item.mode, item.steps[0].prs.map(p => p.ref).join()]), [['켬', 'marked', 'o/r#2']])
  } finally { f.close() }
})

test('리뷰 반례: frontmatter branch 는 문서가 가리키는 레포로 좁히고 추가 조회는 검색을 다시 하지 않는다', () => {
  const f = fixture()
  try {
    f.write('A.md', '---\nspec: active\nbranch: feat/a\n---\n# 브랜치\n\n## 구현\n\no/r#1\n')
    f.write('B.md', '# 자동\n\n## 앞\n\no/r#5\n\n## 뒤\n\no/r#6\n')
    const other = { ...worktree, repo: 'other', branch: 'refs/heads/feat/a', agents: [{ ...worktree.agents[0], paneKey: 'structured-agent-session-wrong:pane' }] }
    const mine = { ...worktree, branch: 'refs/heads/feat/a' }
    const { run, calls } = runner({ 'o/r#1': pr('OPEN', { headRefName: 'x' }), 'o/r#5': pr('MERGED'), 'o/r#6': pr('OPEN') }, ['o/r#6'], [other, mine])
    const items = specs(f.options, f.state, run, 1000)!.items
    assert.deepEqual(items.find(item => item.title === '브랜치')!.sessions.map(session => session.key), ['claude_1'])
    assert.equal(calls.filter(call => call[1] === 'search').length, 1)
  } finally { f.close() }
})

test('백로그로 보낸 명세는 진행 목록에서 빠지고 백로그에 남으며 spec 줄만 바뀐다', () => {
  const f = fixture()
  try {
    const file = join(f.vault, 'notes/plans/A.md')
    f.write('A.md', '---\r\ntags: [plan]\r\n---\r\n# 자동\r\n\r\n## 구현\r\n\r\no/r#7\r\n')
    f.write('B.md', '# 머리 없음\n\n## 구현\n\no/r#7\n')
    const { run } = runner({ 'o/r#7': pr('OPEN') }, ['o/r#7'])
    const before = specs(f.options, f.state, run, 1000)!
    const id = (title: string) => before.items.find(item => item.title === title)!.id
    setSpecStatus(f.options, f.state, id('자동'), 'backlog')
    setSpecStatus(f.options, f.state, id('머리 없음'), 'backlog')
    assert.equal(readFileSync(file, 'utf8'), '---\r\nspec: backlog\r\ntags: [plan]\r\n---\r\n# 자동\r\n\r\n## 구현\r\n\r\no/r#7\r\n')
    assert.match(readFileSync(join(f.vault, 'notes/plans/B.md'), 'utf8'), /^---\nspec: backlog\n---\n# 머리 없음/)
    const after = specs(f.options, f.state, run, 1000)!
    assert.deepEqual(after.items, [])
    assert.deepEqual(after.backlog.map(item => item.title).sort(), ['머리 없음', '자동'])
    setSpecStatus(f.options, f.state, id('자동'), 'active')
    assert.equal(readFileSync(file, 'utf8'), '---\r\nspec: active\r\ntags: [plan]\r\n---\r\n# 자동\r\n\r\n## 구현\r\n\r\no/r#7\r\n')
    assert.deepEqual(specs(f.options, f.state, run, 1000)!.items.map(item => [item.title, item.mode]), [['자동', 'marked']])
    setSpecStatus(f.options, f.state, id('머리 없음'), 'done')
    assert.deepEqual(specs(f.options, f.state, run, 1000)!.done?.map(item => item.title), ['머리 없음'])
    assert.throws(() => setSpecStatus(f.options, f.state, '00000000', 'backlog'), /no longer available/)
  } finally { f.close() }
})

test('세션 워크트리의 docs 에서 브랜치가 고친 문서는 자동 감지해 그 세션에 붙이고 상태는 파일을 고치지 않고 남긴다', () => {
  const f = fixture()
  try {
    const tree = join(f.root, 'tree')
    mkdirSync(join(tree, 'docs/spec'), { recursive: true })
    writeFileSync(join(tree, 'docs/spec/points.md'), '# 포인트\n\n## 1. 적립\n\n- [x] 규칙\n- [ ] 화면\n')
    writeFileSync(join(tree, 'docs/guide.md'), '# 안내\n\n## 사용\n\n- [ ] 읽기\n')
    const main = join(f.root, 'main')
    mkdirSync(join(main, 'docs/spec'), { recursive: true })
    writeFileSync(join(main, 'docs/spec/points.md'), '# 포인트 옛판\n')
    f.options.repos = [main]
    const live = { ...worktree, repo: 'main', path: tree, branch: 'refs/heads/feat/points' }
    const base = runner({}, [], [live])
    const run: Run = (command, args) => command === 'git' ? (args.includes('diff') ? 'docs/spec/points.md\0docs/guide.md\0' : '') : base.run(command, args)
    const result = specs(f.options, f.state, run, 1000)!
    assert.deepEqual(result.items.map(item => [item.title, item.path, item.mode]), [['포인트', 'main/docs/spec/points.md', 'auto']])
    assert.deepEqual(result.items[0].sessions.map(session => session.key), ['claude_1'])
    assert.equal(result.items[0].current, 0)
    setSpecStatus(f.options, f.state, result.items[0].id, 'backlog', run)
    assert.equal(readFileSync(join(tree, 'docs/spec/points.md'), 'utf8'), '# 포인트\n\n## 1. 적립\n\n- [x] 규칙\n- [ ] 화면\n')
    const after = specs(f.options, f.state, run, 1000)!
    assert.deepEqual(after.items, [])
    assert.deepEqual(after.backlog.map(item => item.path), ['main/docs/spec/points.md'])
  } finally { f.close() }
})

test('리뷰 반례: 기준 브랜치가 없어도 새 폴더의 미커밋 명세를 잡고, 고치지 않은 워크트리 사본은 세션에 붙이지 않는다', () => {
  const f = fixture()
  try {
    const tree = join(f.root, 'tree'); const idle = join(f.root, 'idle')
    for (const root of [tree, idle]) { mkdirSync(join(root, 'docs/specs/새기능'), { recursive: true }); writeFileSync(join(root, 'docs/specs/새기능/명세.md'), '---\nbranch: feat/target\n---\n# 새 명세\n\n## 1. 첫 단계\n\n- [ ] 작업\n') }
    const live = { ...worktree, repo: 'app', path: tree, branch: 'refs/heads/feat/target' }
    const other = { ...worktree, repo: 'app', path: idle, branch: 'refs/heads/fix/other', agents: [{ ...worktree.agents[0], paneKey: 'structured-agent-session-other:pane', updatedAt: 99 }] }
    const base = runner({}, [], [other, live])
    const run: Run = (command, args) => {
      if (command !== 'git') return base.run(command, args)
      if (args.includes('diff')) throw new Error("bad revision 'origin/HEAD...HEAD'")
      return args.includes(tree) ? '?? docs/specs/새기능/명세.md\0R  docs/specs/x.md\0docs/specs/old.md\0' : ''
    }
    const result = specs(f.options, f.state, run, 1000)!
    assert.deepEqual(result.items.map(item => item.path), ['app/docs/specs/새기능/명세.md'])
    assert.deepEqual(result.items[0].sessions.map(session => session.key), ['claude_1'])
    assert.deepEqual(result.sessions.map(session => [session.key, session.branch]), [['other', 'fix/other']])
  } finally { f.close() }
})
test('리뷰 반례: 같은 명세를 고친 워크트리가 둘이면 두 세션 모두 붙는다', () => {
  const f = fixture()
  try {
    const trees = ['a', 'b'].map(name => join(f.root, name))
    for (const root of trees) { mkdirSync(join(root, 'docs/specs'), { recursive: true }); writeFileSync(join(root, 'docs/specs/shared.md'), '# 공유\n\n## 1. 단계\n\n- [ ] 작업\n') }
    const live = trees.map((path, index) => ({ ...worktree, repo: 'app', path, branch: `refs/heads/feat/${index}`, agents: [{ ...worktree.agents[0], paneKey: `structured-agent-session-s${index}:pane` }] }))
    const base = runner({}, [], live)
    const run: Run = (command, args) => command !== 'git' ? base.run(command, args) : args.includes('status') ? ' M docs/specs/shared.md\0' : ''
    const result = specs(f.options, f.state, run, 1000)!
    assert.deepEqual(result.items[0].sessions.map(session => session.key).sort(), ['s0', 's1'])
    assert.deepEqual(result.sessions, [])
  } finally { f.close() }
})
