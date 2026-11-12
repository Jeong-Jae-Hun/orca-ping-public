import { assert, test } from 'orca/testing'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { githubInbox } from '../examples/github.ts'
import { publish } from './publish.ts'
import { bridge } from './bridge.ts'

const review = { reason: 'review_requested', repository: { full_name: 'example/project' }, subject: { title: '변경 검토', type: 'PullRequest', url: 'https://api.github.com/repos/example/project/pulls/42' } }

test('본인에게 온 직접 알림을 읽기만 하고 페이지 전체를 처리하며 임의 주소를 따라가지 않는다', () => {
  const inbox = githubInbox([[review, { ...review, reason: 'subscribed' }], [
    { ...review, reason: 'mention', subject: { title: '질문', type: 'Issue', url: 'https://api.github.com/repos/example/project/issues/7' } },
    { ...review, subject: { ...review.subject, url: 'https://attacker.example/repos/example/project/pulls/1' } },
    { ...review, repository: { full_name: 'other/project' } },
  ]])
  assert.equal(inbox.proposals.length, 2)
  assert.equal(inbox.proposals[0].url, 'https://github.com/example/project/pull/42')
  assert.equal(inbox.judgments[1].priority, 'unknown')
  assert.equal(inbox.sources[0].status, 'ok')
  assert.throws(() => githubInbox([{ invalid: true }]))
})

test('수집한 결과는 공개판 계약에 맞으며 프로젝트를 연결하기 전에는 실행하지 않는다', () => {
  const state = mkdtempSync(join(tmpdir(), 'inbox-github-'))
  try {
    const records = Array.from({ length: 30 }, (_, index) => ({ ...review, subject: { ...review.subject, title: '긴 제목 |\n'.repeat(100), url: `https://api.github.com/repos/example/project/pulls/${index + 1}` } }))
    const inbox = githubInbox([records])
    publish(state, JSON.stringify(inbox))
    const value = bridge({ action: 'snapshot' }, state)
    assert.equal(value.proposals.length, 20)
    assert.equal(value.proposals[0].repo, '~')
    assert.match(value.report, /추가 10건/)
    assert.equal(value.proposals[0].title.includes('|'), false)
    publish(state, JSON.stringify(inbox))
    assert.equal(bridge({ action: 'snapshot' }, state).proposals.length, 20)
  } finally { rmSync(state, { recursive: true, force: true }) }
})

test('맥 단독 초기 설정은 자기 Node와 수집기 경로를 저장하고 기존 설정을 덮어쓰지 않는다', () => {
  const state = mkdtempSync(join(tmpdir(), 'inbox-init-'))
  const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
  try {
    execFileSync(process.execPath, [cli, 'init', '--collector', 'github', '--state', state])
    const file = join(state, 'config.json')
    const original = readFileSync(file, 'utf8')
    const config = JSON.parse(original)
    assert.equal(config.collectorCommand[0], process.execPath)
    assert.equal(config.collectorCommand[1].endsWith('/examples/github.ts'), true)
    assert.deepEqual(config.repositories, {})
    assert.throws(() => execFileSync(process.execPath, [cli, 'init', '--collector', 'demo', '--state', state], { stdio: 'pipe' }))
    assert.equal(readFileSync(file, 'utf8'), original)
  } finally { rmSync(state, { recursive: true, force: true }) }
})
