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
export type Snapshot = { theory?: Theory; timeZone?: string; collectionAvailable?: boolean; batch: string; report: string; updatedAt: number; proposals: Proposal[]; collection?: Collection; judgments?: Judgment[]; savedTasks?: SavedTask[]; snoozed?: Reminder[]; reminders?: Reminder[]; sourceHealth?: SourceHealth[] }
export type Request = { action: 'snapshot' | 'start' | 'dismiss' | 'collect' | 'reopen' | 'complete' | 'snooze' | 'unsnooze' | 'priority' | 'theory-read' | 'theory-note' | 'theory-next' | 'theory-preferences' | 'theory-explain'; text?: string; mode?: TheoryExplanation['mode']; id?: string; preset?: 'hour' | 'tomorrow'; priority?: Priority | 'auto' }
export type View = { snapshot: Snapshot | null; error: string | null }

declare module 'orca' {
  interface PluginRequests {
    'ping.view': { output: View }
    'ping.refresh': { output: View }
    'ping.action': { input: Request; output: View }
  }
  interface PluginPanelEvents { 'ping.changed': Record<string, never> }
}
