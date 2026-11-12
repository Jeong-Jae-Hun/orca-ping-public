import { defineCheck } from 'orca/testing'
import type { Snapshot } from './protocol.ts'
const snapshot: Snapshot = { batch: 'test', report: '리뷰 요청 · 1건', updatedAt: 1000, proposals: [
  { id: '1234abcd', title: '리뷰: 변경 내용 확인', repo: '~/Projects/repo', url: 'https://github.com/o/r/pull/1', summary: '정확성·사이드 이펙트·테스트 누락을 확인합니다.', status: 'waiting' }
] }
const learning = { current: { id: '001-foundations', title: '추론 · 결론이 따라온다는 뜻', topic: '논리의 기초', content: '## Reading\n\nAn argument has premises and a conclusion. A valid argument rules out true premises with a false conclusion.\n\n## 한국어 해설\n\n전제가 모두 참인데 결론이 거짓인 경우를 찾아봅니다. 그 경우가 있으면 결론이 전제에서 반드시 따라오지는 않습니다.\n\n## 생각해 볼 질문\n\n로그인했다는 사실만으로 관리자라고 결론 낼 수 있을까요?', readAt: null, order: 1, reason: '정의와 근거부터 공부하려는 방향에 맞춥니다.', notes: [] }, history: [], remaining: 1, preferences: '정의부터 깊게, 개발에서 참고할 공식 명세도 함께' }
export default defineCheck({
  learning: { persisted: { plugin: { section: 'theory' } }, requests: { 'ping.refresh': { snapshot: { ...snapshot, theory: learning }, error: null } } },
  explanation: { persisted: { plugin: { section: 'theory' } }, requests: { 'ping.refresh': { snapshot: { ...snapshot, theory: { ...learning, explanation: { id: '001-foundations', mode: 'counterexample', content: '로그인한 일반 회원을 생각해 봅니다. 로그인했다는 전제는 참이지만 관리자라는 결론은 거짓입니다.\n\n이 예는 로그인만으로 관리자 권한을 보장할 수 없음을 보여 줍니다.', fingerprint: 'test' } } }, error: null } } },

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
