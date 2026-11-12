export type Priority = 'urgent' | 'today' | 'info' | 'unknown'
export type Proposal = { id: string; title: string; repo: string; url: string; summary: string; status: 'waiting' | 'uncertain'; priority?: Priority; manualPriority?: boolean }
export type Collection = { status: 'running' | 'complete' | 'followup' | 'failed'; startedAt: number; message: string; pid?: number }
export type Judgment = { title: string; priority: Priority; id?: string; manualPriority?: boolean; reason: string; action: string; url: string }
export type SavedTask = { id: string; title: string; repo: string; url: string; worktreeId: string; worktreePath: string; sessionId: string; startedAt: number; completed: boolean; phase: 'working' | 'waiting' | 'blocked' | 'done' | 'closed' | 'unknown' }
export type Reminder = { id: string; title: string; url: string; until: number }
export type SourceHealth = { id: string; title: string; status: 'ok' | 'failed' | 'skipped' | 'unknown' | 'stale'; checkedAt: number | null; message: string }
export type LearningEngine = { engine: 'codex' | 'claude' | 'off'; model: string }
export type TheoryLesson = { version?: number; id: string; title: string; topic: string; content: string; readAt: string | null; order: number; reason: string; notes: string[] }
export type TheoryExplanation = { id: string; mode: 'foundations' | 'counterexample'; content: string; fingerprint: string }
export type Theory = { current?: TheoryLesson; history: TheoryLesson[]; remaining: number; preferences?: string; explanation?: TheoryExplanation; error?: string }
// 명세 진행. 원본은 설정한 명세 폴더·레포 docs, PR 상태는 gh, 세션은 orca worktree ps 에서 계산한다.
export type SpecPr = { ref: string; url: string; title: string; branch: string; state: 'open' | 'draft' | 'merged' | 'closed'; review: 'approved' | 'changes' | 'pending' | null; checks: 'pass' | 'fail' | 'pending' | null }
export type SpecStep = { title: string; content: string; prs: SpecPr[]; done: number; total: number; status: 'done' | 'active' | 'todo' }
export type SpecSession = { key: string; title: string; state: string; worktree: string; updatedAt: number; repo?: string; branch?: string; last?: string }
export type Spec = { id: string; title: string; project: string; path: string; mode: 'marked' | 'auto'; updatedAt: number; summary: string; prs: SpecPr[]; steps: SpecStep[]; current: number; sessions: SpecSession[] }
export type Specs = { items: Spec[]; sessions: SpecSession[]; backlog: { id: string; title: string; project: string; path: string }[]; checkedAt: number; error?: string }
export type Snapshot = { specs?: Specs; theory?: Theory; timeZone?: string; collectionAvailable?: boolean; batch: string; report: string; updatedAt: number; proposals: Proposal[]; collection?: Collection; judgments?: Judgment[]; savedTasks?: SavedTask[]; snoozed?: Reminder[]; reminders?: Reminder[]; sourceHealth?: SourceHealth[] }
export type Request = { action: 'snapshot' | 'start' | 'dismiss' | 'collect' | 'reopen' | 'complete' | 'snooze' | 'unsnooze' | 'priority' | 'theory-read' | 'theory-note' | 'theory-next' | 'theory-preferences' | 'theory-explain' | 'spec-open' | 'spec-status' | 'session-open'; text?: string; mode?: TheoryExplanation['mode']; id?: string; preset?: 'hour' | 'tomorrow'; priority?: Priority | 'auto'; key?: string }
export type View = { snapshot: Snapshot | null; error: string | null }

declare module 'orca' {
  interface PluginRequests {
    'ping.view': { output: View }
    'ping.refresh': { output: View }
    'ping.action': { input: Request; output: View }
  }
  interface PluginPanelEvents { 'ping.changed': Record<string, never> }
}
