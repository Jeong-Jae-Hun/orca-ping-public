import { assert, mockHost, mountWorker, test } from 'orca/testing'
import activate, { deactivate } from './worker.ts'
import type { Snapshot } from './protocol.ts'

const snapshot: Snapshot = { batch: 'batch1', report: '리뷰 요청 · 1건', updatedAt: 1000, proposals: [] }

test('학습 설정과 설명 요청을 전달하고 잘못된 글 ID는 전송하지 않는다', async () => {
  const actions: unknown[] = []
  const host = mockHost({ results: { 'notifications.show': { delivered: true }, 'statusBar.update': { ok: true } } })
  const worker = await mountWorker({ default: orca => activate(orca, async input => { actions.push(input); return snapshot }), deactivate }, { host })
  try {
    await worker.request('ping.action', { action: 'theory-preferences', text: '정의부터' })
    await worker.request('ping.action', { action: 'theory-explain', id: '001-claims', mode: 'foundations' })
    assert.equal(actions.filter(item => (item as { action: string }).action.startsWith('theory-')).length, 2)
    await assert.rejects(worker.request('ping.action', { action: 'theory-explain', id: '../escape', mode: 'foundations' }), /Invalid action/)
    assert.equal(actions.filter(item => (item as { id?: string }).id === '../escape').length, 0)
  } finally { await worker.deactivate() }
})

test('새 회차만 알리고 반복 조회에서는 중복 알림을 보내지 않는다', async () => {
  const host = mockHost({ results: { 'notifications.show': { delivered: true }, 'statusBar.update': { ok: true } } })
  const worker = await mountWorker({ default: orca => activate(orca, async () => snapshot), deactivate }, { host })
  await worker.request('ping.refresh')
  await worker.request('ping.refresh')
  assert.equal(host.callsOf('notifications.show').length, 1)
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('연결 실패 때 마지막 보고를 보존하고 오류를 표시한다', async () => {
  const host = mockHost({ storage: { snapshot }, results: { 'statusBar.update': { ok: true } } })
  const worker = await mountWorker({ default: orca => activate(orca, async () => { throw new Error('SSH unavailable') }), deactivate }, { host })
  const result = await worker.request('ping.refresh') as { snapshot: Snapshot; error: string }
  assert.equal(result.snapshot.batch, 'batch1')
  assert.equal(result.error, 'SSH unavailable')
  assert.equal(host.callsOf('notifications.show').length, 0)
  await worker.deactivate()
})


test('참고 알림만 있는 보고는 팝업을 보내지 않는다', async () => {
  const host = mockHost({ results: { 'notifications.show': { delivered: true }, 'statusBar.update': { ok: true } } })
  const worker = await mountWorker({ default: orca => activate(orca, async () => ({ ...snapshot, judgments: [
    { title: '복구 알림', priority: 'info', reason: '이미 복구되었습니다.', action: '추가 조치가 없습니다.', url: '' }
  ] })), deactivate }, { host })
  await worker.request('ping.refresh')
  assert.equal(host.callsOf('notifications.show').length, 0)
  await worker.deactivate()
})


test('다시 볼 시간이 된 알림은 한 번만 보내고 같은 항목의 새 기한은 다시 알린다', async () => {
  const host = mockHost({ storage: { notified: snapshot.batch }, results: { 'notifications.show': { delivered: true }, 'statusBar.update': { ok: true } } })
  let until = 1000
  const worker = await mountWorker({ default: orca => activate(orca, async () => ({ ...snapshot, reminders: [{ id: '1234abcd', title: '다시 볼 작업', url: '', until }] })), deactivate }, { host })
  await worker.request('ping.refresh')
  await worker.request('ping.refresh')
  assert.equal(host.callsOf('notifications.show').length, 1)
  until = 2000
  await worker.request('ping.refresh')
  assert.equal(host.callsOf('notifications.show').length, 2)
  await worker.deactivate()
})

test('기본 연결은 로컬 백엔드에서 읽고 SSH 호스트 입력을 검증한다', async () => {
  const { transport } = await import('./worker.ts')
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const state = mkdtempSync(join(tmpdir(), 'inbox-transport-'))
  try {
    const result = await transport({ action: 'snapshot' }, { stateDirectory: state, nodeExecutable: process.execPath })
    assert.equal(result.report, '')
    assert.equal(result.collectionAvailable, false)
    await assert.rejects(transport({ action: 'snapshot' }, { mode: 'ssh', sshHost: '-oProxyCommand=bad', backendEntry: 'test' }), /valid SSH/)
    await assert.rejects(transport({ action: 'snapshot' }, { mode: 'other' }), /mode/)
  } finally { rmSync(state, { recursive: true, force: true }) }
})

test('캐시 조회는 수집 요청이나 변경 이벤트를 다시 만들지 않는다', async () => {
  let calls = 0
  const host = mockHost({ results: { 'notifications.show': { delivered: true }, 'statusBar.update': { ok: true } } })
  const worker = await mountWorker({ default: orca => activate(orca, async () => { calls++; return snapshot }), deactivate }, { host })
  await worker.request('ping.refresh')
  const before = calls
  assert.deepEqual(await worker.request('ping.view'), { snapshot, error: null })
  await worker.request('ping.view')
  assert.equal(calls, before)
  await worker.deactivate()
})
