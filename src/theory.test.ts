import { assert, test } from 'orca/testing'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { theory } from './theory.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ping-learning-'))
  const state = join(root, 'state')
  const project = state
  mkdirSync(join(state, 'lessons'), { recursive: true })
  for (const [id, title, order] of [['001-decision', '의사결정', 1], ['002-game', '게임이론', 0]] as const)
    writeFileSync(join(project, 'lessons', id + '.md'), `# ${title}\n\n주제: 기초\n상태: 읽기 전\n추천 순서: ${order}\n추천 이유: 기초부터 시작합니다.\n읽은 시각: —\n\n## Reading\nAn outcome is uncertain.\n\n## 내 의견\n아직 없습니다.\n`)
  return { state, project, close: () => rmSync(root, { recursive: true, force: true }) }
}

test('조회나 날짜 변경으로 읽음 처리하거나 다음 글로 넘기지 않는다', () => {
  const f = fixture()
  try {
    const before = readFileSync(join(f.project, 'lessons/001-decision.md'), 'utf8')
    for (const now of [1_000, 1_000_000_000]) {
      const result = theory({ action: 'snapshot' }, f.state, undefined, undefined, now)!
      assert.equal(result.current?.id, '001-decision')
      assert.equal(result.current?.readAt, null)
      assert.equal(result.history.length, 0)
    }
    assert.equal(readFileSync(join(f.project, 'lessons/001-decision.md'), 'utf8'), before)
    let called = false
    assert.throws(() => theory({ action: 'theory-next', id: '001-decision' }, f.state, undefined, () => { called = true; return '{}' }), /Mark the current/)
    assert.equal(called, false)
  } finally { f.close() }
})

test('기본 설정은 AI를 호출하지 않고 읽기와 학습 방향 저장을 허용한다', () => {
  const f = fixture()
  try {
    assert.equal(theory({ action: 'theory-preferences', text: '정의부터' }, f.state)?.preferences, '정의부터')
    assert.throws(() => theory({ action: 'theory-explain', id: '001-decision', mode: 'foundations' }, f.state), /Learning engine is disabled/)
    assert.equal(theory({ action: 'snapshot' }, f.state)?.current?.readAt, null)
  } finally { f.close() }
})

test('읽음은 한 번만 기록한다', () => {
  const f = fixture()
  try {
    const first = theory({ action: 'theory-read', id: '001-decision' }, f.state, undefined, undefined, 1_000)!
    const repeated = theory({ action: 'theory-read', id: '001-decision' }, f.state, undefined, undefined, 2_000)!
    assert.equal(first.history.length, 1)
    assert.equal(repeated.current?.readAt, first.current?.readAt)
    assert.equal(first.current?.readAt, '1970-01-01 09:00 (목요일)')

  } finally { f.close() }
})

test('의견은 선택 사항이며 남긴 의견을 추천에 전달하고 다음 글과 이유를 저장한다', () => {
  const f = fixture()
  try {
    theory({ action: 'theory-note', id: '001-decision', text: '사람들이 협력하는 이유가 궁금해요' }, f.state)
    theory({ action: 'theory-read', id: '001-decision' }, f.state)
    const result = theory({ action: 'theory-next', id: '001-decision' }, f.state, undefined, prompt => {
      assert.match(prompt, /사람들이 협력하는 이유가 궁금해요/)
      return JSON.stringify({ id: '002-game', reason: '협력에 대한 의견을 바탕으로 상호 의존하는 선택을 살펴봅니다.' })
    })!
    assert.equal(result.current?.id, '002-game')
    assert.equal(result.current?.readAt, null)
    assert.match(result.current?.reason ?? '', /협력/)
    assert.equal(result.history[0].notes.length, 1)
    assert.equal(result.remaining, 0)
    assert.equal(theory({ action: 'snapshot' }, f.state)?.current?.id, '002-game')
    assert.throws(() => theory({ action: 'theory-next', id: '001-decision' }, f.state), /changed/)
    // 다른 맥에서 넘어간 뒤에도 이전 글에 의견을 보탤 수 있다.
    const revised = theory({ action: 'theory-note', id: '001-decision', text: '예측과 선호를 구분해 볼게요' }, f.state)!
    assert.equal(revised.history[0].notes.length, 2)
    assert.equal(revised.current?.id, '002-game')
  } finally { f.close() }
})

test('추천 실패나 후보 밖 응답은 현재 글과 이력을 보존하고 재시도할 수 있다', () => {
  const f = fixture()
  try {
    theory({ action: 'theory-read', id: '001-decision' }, f.state)
    const before = readFileSync(join(f.project, 'lessons/002-game.md'), 'utf8')
    assert.throws(() => theory({ action: 'theory-next', id: '001-decision' }, f.state, undefined, () => { throw new Error('Model unavailable') }), /Model unavailable/)
    assert.throws(() => theory({ action: 'theory-next', id: '001-decision' }, f.state, undefined, () => '{"id":"../escape","reason":"선택"}'), /Invalid theory recommendation/)
    assert.equal(readFileSync(join(f.project, 'lessons/002-game.md'), 'utf8'), before)
    assert.equal(existsSync(join(f.project, 'lessons', '.theory.lock')), false)
    const next = theory({ action: 'theory-next', id: '001-decision' }, f.state, undefined, () => '{"id":"002-game","reason":"다른 사람의 선택까지 살펴봅니다."}')!
    assert.equal(next.current?.id, '002-game')
  } finally { f.close() }
})

test('잘못된 입력과 동시 쓰기를 거부하며 표시 전인 글을 바꾸지 않는다', () => {
  const f = fixture()
  try {
    assert.throws(() => theory({ action: 'theory-read', id: '../escape' }, f.state), /Invalid theory action/)
    assert.throws(() => theory({ action: 'theory-read', id: '002-game' }, f.state), /not been recommended/)
    for (const text of ['', 'a'.repeat(601), '의견\n상태: 읽음'])
      assert.throws(() => theory({ action: 'theory-note', id: '001-decision', text }, f.state), /opinion must/)
    mkdirSync(join(f.project, 'lessons', '.theory.lock'))
    assert.throws(() => theory({ action: 'theory-read', id: '001-decision' }, f.state), /busy/)
    assert.equal(existsSync(join(f.project, 'lessons', '.theory.lock')), true)
    assert.equal(theory({ action: 'snapshot' }, f.state)?.current?.readAt, null)
  } finally { f.close() }
})

test('학습 방향은 글을 읽기 전에도 별도로 저장하고 다음 추천에 전달하며 지울 수 있다', () => {
  const f = fixture()
  try {
    const before = readFileSync(join(f.project, 'lessons/001-decision.md'), 'utf8')
    const saved = theory({ action: 'theory-preferences', text: '  정의부터 깊게, 공식 명세도 함께  ' }, f.state)!
    assert.equal(saved.preferences, '정의부터 깊게, 공식 명세도 함께')
    assert.equal(saved.current?.readAt, null)
    assert.equal(readFileSync(join(f.project, 'lessons/001-decision.md'), 'utf8'), before)
    assert.equal(theory({ action: 'snapshot' }, f.state)?.preferences, saved.preferences)
    for (const text of ['a'.repeat(1201), '다음 줄\n쓰기', '\u0000'])
      assert.throws(() => theory({ action: 'theory-preferences', text }, f.state), /Learning direction/)
    assert.equal(theory({ action: 'snapshot' }, f.state)?.preferences, saved.preferences)
    theory({ action: 'theory-read', id: '001-decision' }, f.state)
    theory({ action: 'theory-next', id: '001-decision' }, f.state, undefined, prompt => {
      assert.match(prompt, /Learning direction .*정의부터 깊게, 공식 명세도 함께/)
      return '{"id":"002-game","reason":"학습 방향을 참고합니다."}'
    })
    assert.equal(theory({ action: 'theory-preferences', text: '' }, f.state)?.preferences, '')
    writeFileSync(join(f.state, 'theory-preferences.json'), 'broken')
    assert.equal(theory({ action: 'theory-preferences', text: '복구한 방향' }, f.state)?.preferences, '복구한 방향')
  } finally { f.close() }
})

test('보충 설명은 원문·읽음을 보존하고 새로고침 때 유지하며 실패하면 이전 설명을 남긴다', () => {
  const f = fixture()
  try {
    const before = readFileSync(join(f.project, 'lessons/001-decision.md'), 'utf8')
    let calls = 0
    const explain = (prompt: string) => { calls++; assert.match(prompt, /Do not invent/); return '{"content":"정의부터 설명합니다.\\n\\n어떤 가정이 필요할까요?"}' }
    const result = theory({ action: 'theory-explain', id: '001-decision', mode: 'foundations' }, f.state, undefined, explain)!
    assert.equal(result.current?.readAt, null)
    assert.equal(result.history.length, 0)
    assert.equal(readFileSync(join(f.project, 'lessons/001-decision.md'), 'utf8'), before)
    assert.equal(theory({ action: 'snapshot' }, f.state)?.explanation?.content, result.explanation?.content)
    theory({ action: 'theory-explain', id: '001-decision', mode: 'foundations' }, f.state, undefined, explain)
    assert.equal(calls, 1)
    for (const response of ['{}', '{"content":""}', '{"content":"https://invented.example"}', JSON.stringify({ content: 'a'.repeat(6001) })])
      assert.throws(() => theory({ action: 'theory-explain', id: '001-decision', mode: 'counterexample' }, f.state, undefined, () => response), /Invalid supplemental/)
    assert.equal(theory({ action: 'snapshot' }, f.state)?.explanation?.mode, 'foundations')
    assert.throws(() => theory({ action: 'theory-explain', id: '../escape', mode: 'foundations' }, f.state, undefined, explain), /changed/)
    theory({ action: 'theory-preferences', text: '다른 관점' }, f.state)
    assert.equal(theory({ action: 'snapshot' }, f.state)?.explanation, undefined)
    writeFileSync(join(f.state, 'theory-explanation.json'), 'broken')
    assert.equal(theory({ action: 'snapshot' }, f.state)?.current?.id, '001-decision')
  } finally { f.close() }
})

test('설명의 생성 중에 다른 기기에서 다음 글로 진행하면 오래된 결과를 저장하지 않는다', () => {
  const f = fixture()
  try {
    assert.throws(() => theory({ action: 'theory-explain', id: '001-decision', mode: 'counterexample' }, f.state, undefined, () => {
      theory({ action: 'theory-read', id: '001-decision' }, f.state)
      theory({ action: 'theory-next', id: '001-decision' }, f.state, undefined, () => '{"id":"002-game","reason":"다음 글로 진행합니다."}')
      return '{"content":"오래된 설명"}'
    }), /Learning changed/)
    const result = theory({ action: 'snapshot' }, f.state)!
    assert.equal(result.current?.id, '002-game')
    assert.equal(result.explanation, undefined)
    assert.equal(existsSync(join(f.state, 'theory-explanation.json')), false)
  } finally { f.close() }
})
