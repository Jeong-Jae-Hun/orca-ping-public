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
  execFileSync(process.execPath, [cli, 'learning-demo', '--state', state])
  const learning = JSON.parse(execFileSync(process.execPath, [cli, 'status', '--state', state], { encoding: 'utf8' }))
  assert.equal(learning.theory.current.id, '001-claims', '학습 예제가 자체 데이터 폴더에서 보여야 합니다.')
  assert.equal(learning.theory.current.readAt, null, '조회만으로 읽음 처리하면 안 됩니다.')
  const lessonFile = join(state, 'lessons', '001-claims.md')
  const lessonBefore = readFileSync(lessonFile, 'utf8')
  execFileSync(process.execPath, [cli, 'learning-demo', '--state', state])
  assert.equal(readFileSync(lessonFile, 'utf8'), lessonBefore, '예제 재설치는 기존 학습 상태를 보존해야 합니다.')
  assert.equal(JSON.parse(readFileSync(join(state, 'config.json'), 'utf8')).learning.engine, 'off', '기본 설치에서 AI를 호출하면 안 됩니다.')
  assert.equal(JSON.parse(readFileSync(join(state, 'config.json'), 'utf8')).agent, 'codex', '새 설치는 Codex로 작업을 시작해야 합니다.')
  if (process.platform !== 'win32') assert.equal(statSync(join(state, 'report.md')).mode & 0o077, 0, '보고는 소유자만 읽어야 합니다.')
  const local = join(state, 'local-only')
  execFileSync(process.execPath, [cli, 'init', '--collector', 'demo', '--state', local])
  execFileSync(process.execPath, [cli, 'collect', '--state', local])
  let collected: typeof snapshot
  for (let attempt = 0; attempt < 100; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100))
    collected = JSON.parse(execFileSync(process.execPath, [cli, 'status', '--state', local], { encoding: 'utf8' }))
    if (collected.collection?.status === 'complete') break
  }
  assert.equal(collected!.collection?.status, 'complete', '로컬 수집기가 SSH 없이 완료돼야 합니다.')
  assert.equal(collected!.proposals.length, 1, '백그라운드 수집 결과가 저장돼야 합니다.')
  assert.equal(collected!.collectionAvailable, true, '초기 설정에서 수집기를 연결해야 합니다.')
  console.log('Package smoke test passed: local collection without SSH')
} finally { rmSync(state, { recursive: true, force: true }) }
