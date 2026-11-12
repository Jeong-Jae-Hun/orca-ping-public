import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel.tsx'
import type { Snapshot } from './protocol.ts'

const snapshot: Snapshot = { batch: 'first', report: '새 리뷰 요청', updatedAt: 1000, proposals: [
  { id: '1234abcd', title: '리뷰: 테스트', repo: '~/Projects/repo', url: 'https://github.com/o/r/pull/1', summary: '변경 내용 검토', status: 'waiting' }
] }

test('시작 버튼만 실행 요청을 보내고 완료한 제안을 제거한다', async () => {
  const calls: unknown[] = []
  const host = mockHost({ requests: {
    'ping.refresh': () => ({ snapshot, error: null }),
    'ping.action': input => { calls.push(input); return { snapshot: { ...snapshot, proposals: [], savedTasks: [{ id: '1234abcd', title: '리뷰: 테스트', repo: '~/Projects/repo', url: '', worktreeId: 'test-worktree', worktreePath: '/test/worktree', sessionId: 'test-chat', startedAt: 1000, completed: false, phase: 'working' }] }, error: null } }
  } })
  const view = await mount(panel, { host })
  await view.select({ type: 'Tabs' }, 'tasks')
  assert.equal(calls.length, 0)
  await view.press({ text: '세션 시작' })
  assert.deepEqual(calls, [{ action: 'start', id: '1234abcd' }])
  assert.equal(view.find({ text: '다시 열기' })?.type, 'Button')
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('실행 응답 유실 항목은 다시 시작할 수 없다', async () => {
  const host = mockHost({ requests: { 'ping.refresh': { snapshot: { ...snapshot, proposals: [{ ...snapshot.proposals[0], status: 'uncertain' }] }, error: null } } })
  const view = await mount(panel, { host })
  await view.select({ type: 'Tabs' }, 'tasks')
  assert.equal(view.find({ text: '세션 시작' })?.disabled, true)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})


test('보고는 날짜와 항목을 나누고 긴 주소는 짧은 원문 링크로 표시한다', async () => {
  const report = '## 2026-01-01 09:00 (목요일)\n- 리뷰 요청 · project#42 · https://example.com/tasks/42\n- 서비스 상태 · 확인 1건\n\n**확인 필요** · [기존 링크](https://example.com/path)'
  const host = mockHost({ requests: { 'ping.refresh': { snapshot: { ...snapshot, report }, error: null } } })
  const view = await mount(panel, { host })
  await view.select({ type: 'Tabs' }, 'report')
  const blocks = view.findAll({ type: 'Markdown' })
  assert.equal(blocks.length, 3)
  assert.equal(blocks[0].props.content, '리뷰 요청 · project#42 · [원문](https://example.com/tasks/42)')
  assert.equal(blocks[1].props.content, '서비스 상태 · 확인 1건')
  assert.equal(blocks[2].props.content, '**확인 필요** · [기존 링크](https://example.com/path)')
  assert.equal(view.find({ text: '2026-01-01 09:00 (목요일)' })?.type, 'Text')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})


test('화면 갱신은 조회만 하고 지금 보고 받기는 수집을 요청한다', async () => {
  const actions: unknown[] = []
  let refreshes = 0
  const host = mockHost({ requests: {
    'ping.refresh': () => { refreshes++; return { snapshot, error: null } },
    'ping.action': input => { actions.push(input); return { snapshot: { ...snapshot, collection: { status: 'running', startedAt: 1000, message: '수집 중' } }, error: null } }
  } })
  const view = await mount(panel, { host })
  await view.press({ text: '화면 갱신' })
  assert.equal(actions.length, 0)
  assert.equal(refreshes, 2)
  await view.press({ text: '지금 보고 받기' })
  assert.deepEqual(actions, [{ action: 'collect' }])
  assert.equal(view.find({ text: '수집 중…' })?.disabled, true)
  await view.unmount()
})

test('급한 판단을 먼저 보이고 이유와 권장 행동을 함께 표시한다', async () => {
  const host = mockHost({ requests: { 'ping.refresh': { snapshot: { ...snapshot, judgments: [
    { title: '오늘 답변', priority: 'today', reason: '상대가 답변을 기다립니다.', action: '답변 초안을 검토하세요.', url: '' },
    { title: '운영 오류', priority: 'urgent', reason: '현재 요청 실패가 계속됩니다.', action: '운영 상태를 확인하세요.', url: 'https://example.com/incident' }
  ] }, error: null } } })
  const view = await mount(panel, { host })
  assert.deepEqual(view.findAll({ type: 'Heading' }).slice(1).map(card => card.text), ['운영 오류', '오늘 답변'])
  assert.deepEqual(view.findAll({ type: 'Badge' }).map(badge => badge.text), ['급함', '오늘'])
  assert.equal(view.find({ text: '현재 요청 실패가 계속됩니다.' })?.type, 'Text')
  assert.equal(view.find({ text: '권장 · 운영 상태를 확인하세요.' })?.type, 'Text')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})


test('진행 목록에서 닫힌 대화를 다시 열 때 저장된 작업 ID만 보낸다', async () => {
  const actions: unknown[] = []
  const current = { ...snapshot, savedTasks: [{ id: '1234abcd', title: '리뷰: 테스트', repo: '~/Projects/repo', url: '', worktreeId: 'test-worktree', worktreePath: '/test/worktree', sessionId: 'test-chat', startedAt: 1000, completed: false, phase: 'closed' as const }] }
  const host = mockHost({ requests: { 'ping.refresh': { snapshot: current, error: null }, 'ping.action': input => { actions.push(input); return { snapshot: current, error: null } } } })
  const view = await mount(panel, { host })
  await view.select({ type: 'Tabs' }, 'progress')
  assert.equal(view.find({ text: '다시 열기' })?.disabled, false)
  await view.press({ text: '다시 열기' })
  assert.deepEqual(actions, [{ action: 'reopen', id: '1234abcd' }])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('나중에 보기와 우선순위 변경을 명시적인 요청으로 보낸다', async () => {
  const actions: unknown[] = []
  const host = mockHost({ requests: { 'ping.refresh': { snapshot, error: null }, 'ping.action': input => { actions.push(input); return { snapshot, error: null } } } })
  const view = await mount(panel, { host })
  await view.select({ type: 'Tabs' }, 'tasks')
  await view.toggle({ label: '나중에 보기 · 우선순위' })
  await view.select({ label: '우선순위' }, 'info')
  await view.press({ text: '1시간 뒤' })
  assert.deepEqual(actions, [{ action: 'priority', id: '1234abcd', priority: 'info' }, { action: 'snooze', id: '1234abcd', preset: 'hour' }])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('소스별 실패를 새 알림 없음과 구분해 표시한다', async () => {
  const host = mockHost({ requests: { 'ping.refresh': { snapshot: { ...snapshot, sourceHealth: [{ id: 'slack', title: 'Slack', status: 'failed', checkedAt: 1000, message: '조회에 실패했습니다.' }] }, error: null } } })
  const view = await mount(panel, { host })
  await view.toggle({ label: '수집 상태 · 확인 필요 1개' })
  assert.equal(view.find({ text: 'Slack · 실패' })?.type, 'Text')
  assert.equal(view.find({ text: '조회에 실패했습니다.' })?.type, 'Text')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('수집기를 연결하지 않으면 수동 수집 버튼을 비활성화한다', async () => {
  const host = mockHost({ requests: { 'ping.refresh': { snapshot: { ...snapshot, collectionAvailable: false }, error: null } } })
  const view = await mount(panel, { host })
  assert.equal(view.find({ text: '지금 보고 받기' })?.disabled, true)
  assert.equal(view.find({ text: '설정 파일에 수집 명령을 연결하세요. README에서 시작 방법을 확인할 수 있습니다.' })?.type, 'Text')
  await view.unmount()
})

test('긴 보고 원문은 첫 화면에서 짧게 보여 준다', async () => {
  const line = '긴 보고 내용 '.repeat(100)
  const host = mockHost({ requests: { 'ping.refresh': { snapshot: { ...snapshot, report: line }, error: null } } })
  const view = await mount(panel, { host })
  assert.equal(view.find({ text: line.trim().slice(0, 220) + '…' })?.type, 'Text')
  await view.unmount()
})

test('학습 방향은 접어서 보이고 글별 의견과 다른 요청으로 저장한다', async () => {
  const calls: unknown[] = []
  const lesson = { id: '001-first', title: '첫 글', topic: '기초', content: '## Reading\nA claim.', readAt: null, order: 1, reason: '기초', notes: [] }
  const current = { ...snapshot, theory: { current: lesson, history: [], remaining: 1, preferences: '정의부터 깊게' } }
  const host = mockHost({ requests: {
    'ping.refresh': () => ({ snapshot: current, error: null }),
    'ping.action': input => { calls.push(input); current.theory.preferences = input.text!; return { snapshot: current, error: null } },
  } })
  const view = await mount(panel, { host })
  await view.select({ type: 'Tabs' }, 'theory')
  assert.equal(view.find({ label: '어떻게 배우고 싶나요?' }), null)
  assert.equal(view.find({ label: '이론에 대한 내 의견' }), null)
  assert.equal(view.find({ text: '지금 보고 받기' }), null)
  assert.equal(view.find({ text: '읽었어요' })?.type, 'Button')
  await view.toggle({ label: '학습 방향' })
  assert.equal(view.find({ label: '어떻게 배우고 싶나요?' })?.props.value, '정의부터 깊게')
  await view.type({ label: '어떻게 배우고 싶나요?' }, '기초와 공식 명세를 함께', { replace: true })
  await view.press({ text: '학습 방향 저장' })
  assert.deepEqual(calls, [{ action: 'theory-preferences', text: '기초와 공식 명세를 함께' }])
  assert.equal(view.find({ text: '학습 방향 저장' })?.disabled, true)
  assert.equal(current.theory.current.readAt, null)
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('기초와 반례는 글 아래에 표시하고 읽음이나 다음 추천을 요청하지 않는다', async () => {
  const calls: unknown[] = []
  const lesson = { id: '001-first', title: '첫 글', topic: '기초', content: '원문', readAt: null, order: 1, reason: '기초', notes: [] }
  const host = mockHost({ requests: {
    'ping.refresh': () => ({ snapshot: { ...snapshot, theory: { current: lesson, history: [], remaining: 1 } }, error: null }),
    'ping.action': input => {
      calls.push(input)
      return { snapshot: { ...snapshot, theory: { current: lesson, history: [], remaining: 1, explanation: { id: lesson.id, mode: input.mode!, content: input.mode === 'foundations' ? '정의부터 설명합니다.' : '이 경우에는 성립하지 않습니다.', fingerprint: 'test' } } }, error: null }
    },
  } })
  const view = await mount(panel, { host })
  await view.select({ type: 'Tabs' }, 'theory')
  await view.press({ text: '더 기초부터' })
  assert.ok(view.findAll({ type: 'Markdown' }).some(item => item.props.content === '정의부터 설명합니다.'))
  await view.press({ text: '반례 보기' })
  assert.ok(view.findAll({ type: 'Markdown' }).some(item => item.props.content === '이 경우에는 성립하지 않습니다.'))
  assert.deepEqual(calls, [{ action: 'theory-explain', id: lesson.id, mode: 'foundations' }, { action: 'theory-explain', id: lesson.id, mode: 'counterexample' }])
  assert.equal(view.find({ text: '읽었어요' })?.disabled, false)
  assert.equal(view.find({ text: '다음 이론 추천' }), null)
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('인박스는 작업 제목과 원문 출처를 묶고 보조 입력은 펼칠 때만 표시한다', async () => {
  const proposal = { ...snapshot.proposals[0], title: '리뷰 요청: example/service#42 docs(server): 엔진 경계', url: 'https://github.com/example/service/pull/42' }
  const host = mockHost({ requests: { 'ping.refresh': { snapshot: { ...snapshot, proposals: [proposal], judgments: [
    { id: proposal.id, title: proposal.title, priority: 'today', reason: '리뷰 요청을 받았습니다.', action: '변경 내용을 확인하세요.', url: proposal.url },
  ] }, error: null } } })
  const view = await mount(panel, { host })
  assert.equal(view.find({ text: 'Ping Inbox' })?.type, 'Heading')
  assert.equal(view.find({ type: 'Heading', text: 'docs(server): 엔진 경계' })?.type, 'Heading')
  assert.equal(view.find({ type: 'Text', text: '리뷰 요청 · example/service #42' })?.props.muted, undefined)
  assert.equal(view.find({ text: '오늘' })?.type, 'Badge')
  assert.equal(view.find({ text: '세션 시작' })?.disabled, false)
  assert.equal(view.find({ label: '짧은 의견' }), null)
  assert.equal(view.find({ label: '우선순위' }), null)
  assert.equal(view.find({ label: '판단 엔진' }), null)
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})


test('다크 모드에서도 작업은 테마 표면과 테두리로 구분하고 판단 보류는 경고색으로 표시한다', async () => {
  const host = mockHost({ requests: { 'ping.refresh': { snapshot: { ...snapshot, judgments: [
    { id: '1234abcd', title: '확인이 필요한 오류', priority: 'unknown', reason: '영향 범위를 확인하지 못했습니다.', action: '관련 로그를 확인하세요.', url: 'https://example.com/issue' },
  ] }, error: null } } })
  const view = await mount(panel, { host })
  await view.select({ type: 'Tabs' }, 'now')
  const cards = view.findAll({ type: 'Box' })
  assert.equal(cards.length, 1)
  assert.equal(cards[0].props.background, 'muted')
  assert.equal(cards[0].props.border, 'neutral')
  assert.equal(view.find({ type: 'Heading', text: '확인이 필요한 오류' })?.type, 'Heading')
  assert.equal(view.find({ type: 'Badge', text: '판단 보류' })?.props.tone, 'warning')
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('명세 탭은 단계 흐름을 모두 보이고 세션 열기는 그 세션 키만 보낸다', async () => {
  const calls: unknown[] = []
  const pr = { ref: 'o/r#2', url: 'https://github.com/o/r/pull/2', title: 'API', branch: 'feat/a', state: 'open' as const, review: 'pending' as const, checks: 'pass' as const }
  const specs = { checkedAt: 1000, sessions: [{ key: 'claude_2', title: 'QA 확인', state: 'waiting', worktree: '/w/qa', updatedAt: 1, repo: 'specs', branch: 'qa', last: '정리했습니다.' }], backlog: [{ id: 'ffff0000', title: '인프라 백로그', project: 'notes', path: 'notes/backlog.md' }], items: [{ id: 'abcd1234', title: '결제 대행', project: 'notes', path: 'notes/a.md', mode: 'auto' as const, updatedAt: 1000, summary: '요약', prs: [pr],
    steps: [{ title: '1. 스키마', content: '', prs: [], done: 2, total: 2, status: 'done' as const }, { title: '2. API', content: '- 끝: 옛 파이프라인은 0개입니다(`list-pipelines`). [[../_ARCHIVE|아카이브]] 참고\n- [ ] 서명 검증', prs: [pr], done: 0, total: 0, status: 'active' as const }, { title: '3. 배포', content: '', prs: [], done: 0, total: 1, status: 'todo' as const }],
    current: 1, sessions: [{ key: 'claude_1', title: '구현 중', state: 'working', worktree: '/w', updatedAt: 1 }] }] }
  const host = mockHost({ requests: {
    'ping.refresh': () => ({ snapshot: { ...snapshot, specs }, error: null }),
    'ping.action': input => { calls.push(input); return { snapshot: { ...snapshot, specs }, error: null } }
  } })
  const view = await mount(panel, { host })
  await view.select({ type: 'Tabs' }, 'specs')
  await view.toggle({ type: 'Collapsible', text: /명세 보기/ })
  await view.toggle({ type: 'Collapsible', text: /2\. API/ })
  assert.ok(view.find({ text: '· 끝: 옛 파이프라인은 0개입니다. 아카이브 참고' }))
  assert.ok(view.find({ text: '☐ 서명 검증' }))
  for (const text of ['✓ 1. 스키마', '▶ 2. API', '○ 3. 배포', '리뷰', 'CI 통과']) assert.ok(view.find({ text }), text)
  await view.press({ text: '세션 열기 · 구현 중 · 실행 중' })
  assert.ok(view.find({ text: '대기 중 · specs · qa' }))
  await view.press({ text: '열기' })
  await view.press({ text: '완료' })
  await view.press({ text: '백로그로' })
  await view.toggle({ type: 'Collapsible', text: /백로그 1/ })
  await view.press({ text: '다시 진행' })
  assert.deepEqual(calls, [{ action: 'spec-open', id: 'abcd1234', key: 'claude_1' }, { action: 'session-open', key: 'claude_2' }, { action: 'spec-status', id: 'abcd1234', text: 'done' }, { action: 'spec-status', id: 'abcd1234', text: 'backlog' }, { action: 'spec-status', id: 'ffff0000', text: 'active' }])
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})
