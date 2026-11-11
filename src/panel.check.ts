import { defineCheck } from 'orca/testing'
import type { Snapshot } from './protocol.ts'
const snapshot: Snapshot = { batch: 'test', report: '리뷰 요청 · 1건', updatedAt: 1000, proposals: [
  { id: '1234abcd', title: '리뷰: 변경 내용 확인', repo: '~/Projects/repo', url: 'https://github.com/o/r/pull/1', summary: '정확성·사이드 이펙트·테스트 누락을 확인합니다.', status: 'waiting' }
] }
export default defineCheck({
  waiting: { requests: { 'ping.refresh': { snapshot, error: null } } },
  attention: { requests: { 'ping.refresh': { snapshot: { ...snapshot, judgments: [
    { title: '운영 요청 실패', priority: 'urgent', reason: '현재 실패가 이어져 이용에 영향이 있습니다.', action: '실패 구간과 최근 변경을 확인하세요.', url: 'https://example.com/incident' },
    { title: '리뷰: 변경 내용 확인', priority: 'today', reason: '작성자가 검토를 기다립니다.', action: '변경 내용을 검토하고 답변을 준비하세요.', url: 'https://example.com/review' }
  ] }, error: null } } },
  saved: { persisted: { plugin: { section: 'progress' } }, requests: { 'ping.refresh': { snapshot: { ...snapshot, savedTasks: [{ id: '1234abcd', title: '저장된 검토 작업', repo: '~/Projects/repo', url: 'https://example.com/task', worktreeId: 'test-worktree', worktreePath: '/test/task', sessionId: 'saved-chat', startedAt: 1000, completed: false, phase: 'closed' }] }, error: null } } },
  unhealthy: { requests: { 'ping.refresh': { snapshot: { ...snapshot, sourceHealth: [{ id: 'slack', title: 'Slack', status: 'failed', checkedAt: 1000, message: '조회에 실패했습니다.' }] }, error: null } } },
  collecting: { requests: { 'ping.refresh': { snapshot: { ...snapshot, collection: { status: 'running', startedAt: 1000, message: '새 알림을 수집하고 있습니다.' } }, error: null } } },
  empty: { requests: { 'ping.refresh': { snapshot: { ...snapshot, report: '', proposals: [] }, error: null } } },
  offline: { requests: { 'ping.refresh': { snapshot, error: 'SSH unavailable' } } }
})
