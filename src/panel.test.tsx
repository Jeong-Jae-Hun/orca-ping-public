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
  const titles = view.findAll({ type: 'Text' }).map(item => item.text).filter(text => text.startsWith('급함 ·') || text.startsWith('오늘 ·'))
  assert.deepEqual(titles, ['급함 · 운영 오류', '오늘 · 오늘 답변'])
  assert.equal(view.find({ text: '현재 요청 실패가 계속됩니다.' })?.type, 'Text')
  assert.equal(view.find({ text: '권장: 운영 상태를 확인하세요.' })?.type, 'Text')
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
