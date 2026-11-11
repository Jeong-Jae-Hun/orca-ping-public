import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const state = mkdtempSync(join(tmpdir(), 'inbox-package-'))
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
try {
  execFileSync(process.execPath, [cli, 'init', '--state', state])
  execFileSync(process.execPath, [cli, 'demo', '--state', state])
  const snapshot = JSON.parse(execFileSync(process.execPath, [cli, 'status', '--state', state], { encoding: 'utf8' }))
  assert.equal(snapshot.proposals.length, 1, '예제 제안이 보여야 합니다.')
  assert.equal(snapshot.proposals[0].repo, '~', '미등록 프로젝트는 실행할 수 없어야 합니다.')
  assert.equal(snapshot.judgments[0].priority, 'today', '보고와 연결된 판단이 있어야 합니다.')
  assert.equal(snapshot.sourceHealth[0].status, 'ok', '실제 데모 수집 시각이 반영돼야 합니다.')
  assert.equal(snapshot.collectionAvailable, false, '기본 설치는 외부 명령을 실행하지 않아야 합니다.')
  assert.match(readFileSync(join(state, 'report.md'), 'utf8'), /예제 보고/)
  if (process.platform !== 'win32') assert.equal(statSync(join(state, 'report.md')).mode & 0o077, 0, '보고는 소유자만 읽어야 합니다.')
  console.log('Package smoke test passed')
} finally { rmSync(state, { recursive: true, force: true }) }
