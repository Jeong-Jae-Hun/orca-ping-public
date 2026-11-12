import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { assert, test } from 'orca/testing'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bridge } from './bridge.ts'

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'ping-panel-'))
  const state = join(home, '.cache/ping')
  mkdirSync(state, { recursive: true }); writeFileSync(join(state, 'config.json'), JSON.stringify({ timeZone: 'Asia/Seoul' })); mkdirSync(join(home, 'Projects/repo'), { recursive: true }); mkdirSync(join(home, 'assistant'))
  execFileSync('git', ['init', '--quiet', join(home, 'Projects/repo')])
  writeFileSync(join(state, 'proposals.md'), '리뷰: 테스트 | ~/Projects/repo | https://github.com/o/r/pull/1 | $(touch /tmp/ping-panel-injected) | 코드 검토 | tab:term_old\n')
  writeFileSync(join(state, 'report.md'), '리뷰 1건')
  const launch = { ok: true, result: { worktree: { id: 'test-worktree', path: join(home, 'worktree') }, launch: { outcome: { sessionId: 'test-chat' } } } };
  return { home, state, launch, close: () => rmSync(home, { recursive: true, force: true }) }
}

test('학습 방향은 작업 실행 없이 저장하고 학습 기록 손상은 보고를 숨기지 않는다', () => {
  const f = fixture()
  try {
    const saved = bridge({ action: 'theory-preferences', text: '정의부터 깊게' }, f.state, f.home, () => { throw new Error('Must not start a task') })
    assert.equal(saved.theory?.preferences, '정의부터 깊게')
    assert.equal(saved.proposals.length, 1)
    writeFileSync(join(f.state, 'theory-preferences.json'), 'broken')
    const recovered = bridge({ action: 'snapshot' }, f.state, f.home)
    assert.equal(recovered.report, '리뷰 1건')
    assert.match(recovered.theory?.error ?? '', /Learning data/)
    writeFileSync(join(f.state, 'config.json'), JSON.stringify({ learning: { engine: 'codex', model: '' } }))
    assert.throws(() => bridge({ action: 'snapshot' }, f.state, f.home), /Learning model is required/)
  } finally { f.close() }
})

test('조회는 실행하지 않고 시작은 정확히 한 번만 요청한다', () => {
  const f = fixture(); const calls: string[][] = []
  try {
    const snapshot = bridge({ action: 'snapshot' }, f.state, f.home, args => { calls.push(args); return args[0] === 'worktree' && args[1] === 'create' ? f.launch : { ok: true } })
    assert.equal(calls.length, 0)
    const id = snapshot.proposals[0].id
    const result = bridge({ action: 'start', id }, f.state, f.home, args => { calls.push(args); return args[0] === 'worktree' && args[1] === 'create' ? f.launch : { ok: true } })
    assert.equal(result.proposals.length, 0)
    assert.equal(result.savedTasks?.[0].sessionId, 'test-chat')
    assert.equal(result.savedTasks?.[0].worktreeId, 'test-worktree')
    assert.deepEqual(calls[0].slice(0, 2), ['worktree', 'create'])
    assert.equal(calls[0][calls[0].indexOf('--repo') + 1], 'path:' + join(f.home, 'Projects/repo'))
    assert.equal(calls[0][calls[0].indexOf('--parent-worktree') + 1], 'path:' + join(f.home, 'Projects/repo'))
    assert.equal(calls[0].includes('--no-parent'), false)
    assert.equal(calls[0][calls[0].indexOf('--surface') + 1], 'chat')
    assert.equal(calls[0][calls[0].indexOf('--agent') + 1], 'codex')
    assert.match(calls[0][calls[0].indexOf('--prompt') + 1], /\$\(touch \/tmp\/ping-panel-injected\)/)
    assert.throws(() => bridge({ action: 'start', id }, f.state, f.home, args => { calls.push(args); return args[0] === 'worktree' && args[1] === 'create' ? f.launch : { ok: true } }), /already handled/)
    assert.equal(calls.filter(args => args[0] === 'worktree' && args[1] === 'create').length, 1)
  } finally { f.close() }
})

test('응답 유실은 실행 불확실 상태로 남아 다른 맥에서도 재실행되지 않는다', () => {
  const f = fixture()
  try {
    const id = bridge({ action: 'snapshot' }, f.state, f.home).proposals[0].id
    assert.throws(() => bridge({ action: 'start', id }, f.state, f.home, () => { throw new Error('Lost response') }), /Lost response/)
    assert.equal(bridge({ action: 'snapshot' }, f.state, f.home).proposals[0].status, 'uncertain')
    assert.throws(() => bridge({ action: 'start', id }, f.state, f.home), /already handled/)
  } finally { f.close() }
})

test('버리기는 원본 제안과 보고를 보존하고 목록에서만 숨긴다', () => {
  const f = fixture()
  try {
    const id = bridge({ action: 'snapshot' }, f.state, f.home).proposals[0].id
    assert.equal(bridge({ action: 'dismiss', id }, f.state, f.home, () => ({ ok: true })).proposals.length, 0)
    assert.match(readFileSync(join(f.state, 'proposals.md'), 'utf8'), /리뷰: 테스트/)
    assert.equal(readFileSync(join(f.state, 'report.md'), 'utf8'), '리뷰 1건')
    assert.throws(() => bridge({ action: 'start', id: '../bad' }, f.state, f.home), /Invalid proposal/)
  } finally { f.close() }
})

test('동시 클릭 잠금이 있으면 실행을 거부한다', () => {
  const f = fixture()
  try {
    const id = bridge({ action: 'snapshot' }, f.state, f.home).proposals[0].id
    mkdirSync(join(f.state, 'panel-actions', id + '.lock'))
    assert.throws(() => bridge({ action: 'start', id }, f.state, f.home), /already being handled/)
  } finally { f.close() }
})


test('다른 보고의 판단을 현재 보고의 판단으로 보여주지 않는다', () => {
  const f = fixture()
  try {
    writeFileSync(join(f.state, 'briefing.json'), JSON.stringify({ batch: 'stale', items: [{ priority: 'urgent' }] }))
    assert.equal(bridge({ action: 'snapshot' }, f.state, f.home).judgments, undefined)
  } finally { f.close() }
})


test('원본 제안이 정리돼도 저장한 같은 세션을 다시 연다', () => {
  const f = fixture(); const opened: string[] = []; const commands: string[][] = [];
  try {
    const id = bridge({ action: 'snapshot' }, f.state, f.home).proposals[0].id;
    bridge({ action: 'start', id }, f.state, f.home, () => f.launch);
    writeFileSync(join(f.state, 'proposals.md'), '');
    const result = bridge({ action: 'reopen', id }, f.state, f.home, args => { commands.push(args); return { ok: true, result: { truncated: false, worktrees: [] } } }, sessionId => {
      opened.push(sessionId); return { sessionId, workspaceId: 'test-worktree', agent: 'claude' };
    });
    assert.deepEqual(opened, ['test-chat']);
    assert.equal(commands.some(args => args[1] === 'create'), false);
    assert.equal(result.savedTasks?.[0].sessionId, 'test-chat');
  } finally { f.close(); }
});

test('닫힌 채팅은 닫힘으로 표시하고 완료 표시 후에도 복원 식별자를 보존한다', () => {
  const f = fixture();
  const run = (args: string[]) => args[1] === 'create' ? f.launch : { ok: true, result: { truncated: false, worktrees: [{ worktreeId: 'test-worktree', agents: [] }] } };
  try {
    const id = bridge({ action: 'snapshot' }, f.state, f.home).proposals[0].id;
    const started = bridge({ action: 'start', id }, f.state, f.home, run);
    assert.equal(started.savedTasks?.[0].phase, 'closed');
    const done = bridge({ action: 'complete', id }, f.state, f.home, run);
    assert.equal(done.savedTasks?.[0].completed, true);
    assert.equal(done.savedTasks?.[0].sessionId, 'test-chat');
  } finally { f.close(); }
});

test('저장된 대화가 없으면 새 대화로 대체하지 않는다', () => {
  const f = fixture(); let creates = 0;
  try {
    const id = bridge({ action: 'snapshot' }, f.state, f.home).proposals[0].id;
    bridge({ action: 'start', id }, f.state, f.home, () => f.launch);
    assert.throws(() => bridge({ action: 'reopen', id }, f.state, f.home, () => { creates++; return f.launch }, () => { throw new Error('Saved session missing') }), /Saved session missing/);
    assert.equal(creates, 0);
  } finally { f.close(); }
});

test('나중에 보기는 두 맥에 동일하게 적용되고 시간이 지나면 다시 나타난다', () => {
  const f = fixture(); const now = new Date('2026-01-01T12:00:00+09:00').getTime();
  try {
    const id = bridge({ action: 'snapshot' }, f.state, f.home).proposals[0].id;
    const paused = bridge({ action: 'snooze', id, preset: 'hour' }, f.state, f.home, undefined, undefined, now);
    assert.equal(paused.proposals.length, 0);
    assert.equal(paused.snoozed?.[0].id, id);
    assert.equal(bridge({ action: 'snapshot' }, f.state, f.home, undefined, undefined, now).proposals.length, 0);
    const due = bridge({ action: 'snapshot' }, f.state, f.home, undefined, undefined, paused.snoozed![0].until);
    assert.equal(due.proposals.length, 1);
    assert.equal(due.reminders?.[0].id, id);
    const restored = bridge({ action: 'unsnooze', id }, f.state, f.home);
    assert.equal(restored.snoozed?.length, 0);
    assert.equal(restored.reminders?.length, 0);
  } finally { f.close(); }
});

test('내일 오전 9시 알림은 한국시간으로 계산한다', async () => {
  const { snoozeUntil } = await import('./bridge.ts');
  assert.equal(snoozeUntil('tomorrow', new Date('2026-01-01T23:50:00+09:00').getTime()), new Date('2026-01-02T09:00:00+09:00').getTime());
});

test('사용자 우선순위는 보존하고 자동 판단으로 되돌릴 수 있다', () => {
  const f = fixture();
  try {
    const id = bridge({ action: 'snapshot' }, f.state, f.home).proposals[0].id;
    const changed = bridge({ action: 'priority', id, priority: 'info' }, f.state, f.home);
    assert.equal(changed.proposals[0].priority, 'info');
    assert.equal(changed.proposals[0].manualPriority, true);
    assert.equal(bridge({ action: 'snapshot' }, f.state, f.home).proposals[0].priority, 'info');
    assert.equal(bridge({ action: 'priority', id, priority: 'auto' }, f.state, f.home).proposals[0].manualPriority, false);
    assert.throws(() => bridge({ action: 'priority', id, priority: 'invalid' as 'urgent' }, f.state, f.home), /Invalid priority/);
  } finally { f.close(); }
});


test('같은 원문의 제목이 바뀌어도 사용자 우선순위와 시작한 작업에 연결한다', () => {
  const f = fixture();
  try {
    const id = bridge({ action: 'snapshot' }, f.state, f.home).proposals[0].id;
    const batch = createHash('sha1').update(readFileSync(join(f.state, 'report.md'), 'utf8')).digest('hex').slice(0, 8);
    writeFileSync(join(f.state, 'briefing.json'), JSON.stringify({ batch, items: [{ title: '변경된 알림 제목', priority: 'urgent', reason: '확인이 필요합니다.', action: '내용을 확인하세요.', url: 'https://github.com/o/r/pull/1' }] }));
    const changed = bridge({ action: 'priority', id, priority: 'info' }, f.state, f.home);
    assert.equal(changed.judgments?.[0].id, id);
    assert.equal(changed.judgments?.[0].priority, 'info');
    assert.equal(changed.judgments?.[0].manualPriority, true);
    const started = bridge({ action: 'start', id }, f.state, f.home, () => f.launch);
    assert.equal(started.judgments?.length, 0);
  } finally { f.close(); }
});

test('이전 버전에서 저장한 전체 실행 영수증도 같은 세션으로 복원한다', () => {
  const f = fixture();
  try {
    const original = bridge({ action: 'snapshot' }, f.state, f.home).proposals[0];
    writeFileSync(join(f.state, 'panel-actions', original.id + '.json'), JSON.stringify({ title: original.title, status: 'started', result: f.launch }));
    const reopened = bridge({ action: 'reopen', id: original.id }, f.state, f.home, () => ({ ok: true }), sessionId => ({ sessionId, workspaceId: 'test-worktree', agent: 'claude' }));
    assert.equal(reopened.savedTasks?.[0].sessionId, 'test-chat');
  } finally { f.close(); }
});

test('자식 작업이 실행 중이면 부모 응답이 끝나도 전체 작업을 실행 중으로 표시한다', () => {
  const f = fixture();
  try {
    const id = bridge({ action: 'snapshot' }, f.state, f.home).proposals[0].id;
    const snapshot = bridge({ action: 'start', id }, f.state, f.home, args => args[1] === 'create' ? f.launch : { ok: true, result: { truncated: false, worktrees: [{ worktreeId: 'test-worktree', agents: [{ paneKey: 'structured-agent-session-test-chat:one', state: 'working', mainAgent: { state: 'done' } }] }] } });
    assert.equal(snapshot.savedTasks?.[0].phase, 'working');
  } finally { f.close(); }
});

test('내일 알림은 백엔드 설정 시간대를 따른다', async () => {
  const { snoozeUntil } = await import('./bridge.ts')
  const now = Date.parse('2026-01-01T23:30:00Z')
  assert.equal(new Date(snoozeUntil('tomorrow', now, 'UTC')).toISOString(), '2026-01-02T09:00:00.000Z')
  assert.equal(new Date(snoozeUntil('tomorrow', now, 'America/New_York')).toISOString(), '2026-01-02T14:00:00.000Z')
})
