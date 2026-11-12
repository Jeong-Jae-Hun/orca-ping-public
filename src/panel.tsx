import { atom, Badge, Box, Button, Callout, Collapsible, Heading, Input, Link, Markdown, plugin, read, RelativeTime, Row, Select, set, Stack, Tab, Tabs, Text, type CardProps, type PanelContext } from 'orca'
import type { Judgment, Priority, Proposal, Request, SavedTask, Theory, TheoryLesson, View } from './protocol.ts'

const view = atom<View>({ snapshot: null, error: null })
const busy = atom(false)
const section = atom<string | null>('section', null, { persist: 'plugin' })
const query = atom('')
const visible = atom(8)
const theoryDrafts = atom<Record<string, string>>({})
const learningDraft = atom<string | null>(null)
const learningAction = atom<Request['action'] | null>(null)
const priorities = { urgent: 0, today: 1, unknown: 2, info: 3 }
const phaseLabels = { working: '실행 중', waiting: '대기 중', blocked: '확인 필요', done: '응답 완료', closed: '세션 연결 없음 · 대화 저장됨', unknown: '상태 확인 필요' }
const healthLabels = { ok: '정상', failed: '실패', skipped: '건너뜀', stale: '오래됨', unknown: '미확인' }
function formatTime(at: number, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)
}
const priorityOptions = [{ value: 'auto', label: '자동 판단' }, { value: 'urgent', label: '급함' }, { value: 'today', label: '오늘' }, { value: 'info', label: '참고' }, { value: 'unknown', label: '판단 보류' }]
const priorityLabels = { urgent: '급함', today: '오늘', info: '참고', unknown: '판단 보류' }
const priorityTones = { urgent: 'danger', today: 'accent', info: 'neutral', unknown: 'warning' } as const

async function refresh() {
  set(busy, true)
  try {
    const answer = await plugin.request('ping.refresh')
    set(view, answer)
    if (read(section) === null) set(section, 'now')
  }
  catch (error) { set(view, { ...read(view), error: String(error) }) }
  finally { set(busy, false) }
}

async function act(action: Request['action'], id?: string, extra: Pick<Request, 'preset' | 'priority' | 'text' | 'mode'> = {}) {
  set(busy, true)
  set(learningAction, action)
  try {
    const answer = await plugin.request('ping.action', id ? { action, id, ...extra } : { action, ...extra }, { timeoutMs: 120_000 })
    set(view, answer)
    if (action === 'theory-note' && id && !answer.error) set(theoryDrafts, { ...read(theoryDrafts), [id]: '' })
    if (action === 'theory-preferences' && !answer.error) set(learningDraft, null)
    if (action === 'start' && !answer.error) set(section, 'progress')
    if (action === 'unsnooze' && !answer.error) set(section, answer.snapshot?.proposals.some(item => item.id === id) ? 'tasks' : 'now')
  }
  catch (error) { set(view, { ...read(view), error: String(error) }) }
  finally { set(busy, false); set(learningAction, null) }
}

export function setup(ctx: PanelContext) {
  ctx.subscriptions.push(plugin.on('ping.changed', () => { void plugin.request('ping.view').then(value => set(view, value)).catch(error => set(view, { ...read(view), error: String(error) })) }))
  void refresh()
}

function TaskActions({ id, proposal, url, priority }: { id: string; proposal?: Proposal; url?: string; priority?: Priority }) {
  const disabled = read(busy) || proposal?.status === 'uncertain'
  return <Stack gap="sm">
    <Row gap="sm" wrap>
      {proposal && <Button size="sm" disabled={disabled || proposal.repo === '~'} onPress={() => act('start', id)}>세션 시작</Button>}
      {url && <Link href={url}>원문</Link>}
      <Button size="sm" variant="ghost" disabled={disabled} onPress={() => act('dismiss', id)}>버리기</Button>
    </Row>
    <Collapsible title="나중에 보기 · 우선순위">
      <Stack gap="sm">
        <Text muted size="xs">알림 시간대 · {read(view).snapshot?.timeZone ?? '기기 시간대'}</Text>
        <Select label="우선순위" value={priority ?? 'auto'} options={priorityOptions} disabled={disabled} onChange={value => act('priority', id, { priority: value as Priority | 'auto' })} />
        <Row gap="sm" wrap>
          <Button size="sm" variant="ghost" disabled={disabled} onPress={() => act('snooze', id, { preset: 'hour' })}>1시간 뒤</Button>
          <Button size="sm" variant="ghost" disabled={disabled} onPress={() => act('snooze', id, { preset: 'tomorrow' })}>내일 오전 9시</Button>
        </Row>
      </Stack>
    </Collapsible>
  </Stack>
}

function splitTitle(title: string, repo?: string, url?: string) {
  const match = /^(?:([^:]+): )?([\w.-]+\/[\w.-]+)#(\d+)\s+([\s\S]+)$/.exec(title)
  if (match) {
    const [, label, repository, number, subject] = match
    return { subject, source: [label, `${repository} #${number}`].filter(Boolean).join(' · ') }
  }
  const github = url?.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:pull|issues)\/(\d+)/)
  const source = github ? `${github[1]} #${github[2]}` : repo?.split('/').at(-1)
  const kind = title.startsWith('리뷰:') ? '리뷰 요청' : title.includes(': ') ? title.split(': ')[0] : '알림'
  return { subject: title, source: source ? `${kind} · ${source}` : undefined }
}

function TaskCard({ title, description, children }: CardProps) {
  return <Box gap="md" padding="lg" background="muted" border="neutral" radius="md">
    <Stack gap="xs">
      <Heading level={3}><Text size="md" weight="semibold">{title}</Text></Heading>
      {description && <Text size="sm">{description}</Text>}
    </Stack>
    {children}
  </Box>
}

function ProgressTask({ task }: { task: SavedTask }) {
  const disabled = read(busy)
  return <Stack gap="sm">
    <Text weight="semibold">{task.title}</Text>
    <Text muted size="xs">{phaseLabels[task.phase]} · {task.worktreePath.split('/').at(-1) || task.repo.split('/').at(-1)}</Text>
    <Row gap="sm" wrap>
      <Button size="sm" disabled={disabled || !task.sessionId || !task.worktreeId} onPress={() => act('reopen', task.id)}>다시 열기</Button>
      {!task.completed && <Button size="sm" variant="ghost" disabled={disabled} onPress={() => act('complete', task.id)}>완료로 표시</Button>}
      {task.url && <Link href={task.url}>원문</Link>}
    </Row>
  </Stack>
}

function TheoryReading({ lesson, pending, current, remaining, explanation }: { lesson: TheoryLesson; pending: boolean; current: boolean; remaining: number; explanation?: Theory['explanation'] }) {
  const text = read(theoryDrafts)[lesson.id] ?? ''
  return <Stack gap="md">
    <Heading level={3}>{lesson.title}</Heading>
    <Text muted size="xs">{lesson.readAt ? `읽음 · ${lesson.readAt}` : '읽기 전 · 날짜가 바뀌어도 이 글을 유지합니다.'}</Text>
    <Markdown content={lesson.content} />
    <Row gap="sm" wrap>
      {current && !lesson.readAt && <Button size="sm" disabled={pending} onPress={() => act('theory-read', lesson.id)}>읽었어요</Button>}
      {current && lesson.readAt && remaining > 0 && <Button size="sm" disabled={pending} onPress={() => act('theory-next', lesson.id)}>{pending && read(learningAction) === 'theory-next' ? '추천 중…' : '다음 이론 추천'}</Button>}
      {current && <Button size="sm" variant="ghost" disabled={pending} onPress={() => act('theory-explain', lesson.id, { mode: 'foundations' })}>더 기초부터</Button>}
      {current && <Button size="sm" variant="ghost" disabled={pending} onPress={() => act('theory-explain', lesson.id, { mode: 'counterexample' })}>반례 보기</Button>}
    </Row>
    {current && pending && read(learningAction) === 'theory-explain' && <Text muted size="sm">보충 설명을 준비하고 있습니다.</Text>}
    {current && explanation?.id === lesson.id && <Stack gap="sm">
      <Text weight="semibold">{explanation.mode === 'foundations' ? '더 기초부터' : '반례와 한계'}</Text>
      <Markdown content={explanation.content} />
      <Text muted size="xs">AI가 덧붙인 설명입니다. 공식 근거는 원문의 출처에서 확인하세요.</Text>
    </Stack>}
    {current && lesson.readAt && remaining === 0 && <Text size="sm">준비된 글을 모두 읽었습니다. 다음 학습 글을 추가하면 이어갈 수 있습니다.</Text>}
    <Collapsible title="의견과 추천 이유">
      <Stack gap="sm">
        <Text size="sm">{lesson.reason}</Text>
        {lesson.notes.map((note, index) => <Text key={index} muted size="sm">{note.replace(/^- /, '')}</Text>)}
        <Input label="이론에 대한 내 의견" placeholder="궁금한 점이나 내 말로 설명한 내용을 남겨보세요" value={text} maxLength={600} disabled={pending}
          onChange={value => set(theoryDrafts, { ...read(theoryDrafts), [lesson.id]: value })} />
        <Row><Button size="sm" variant="ghost" disabled={pending || !text.trim()} onPress={() => act('theory-note', lesson.id, { text })}>학습 의견 저장</Button></Row>
        <Text muted size="xs">의견은 다음 추천에 참고합니다. 읽음 표시는 이해도 평가가 아닙니다.</Text>
      </Stack>
    </Collapsible>
  </Stack>
}

function TheoryPanel({ learning, pending }: { learning?: Theory; pending: boolean }) {
  return <Stack gap="lg">
    {!learning && <Text size="sm">아직 학습 프로젝트가 연결되지 않았습니다.</Text>}
    {learning?.error && <Text size="sm">{learning.error}</Text>}
    {learning && !learning.current && !learning.error && <Text size="sm">아직 준비된 학습 글이 없습니다.</Text>}
    {learning?.current && <TheoryReading lesson={learning.current} pending={pending} current remaining={learning.remaining} explanation={learning.explanation} />}
    {learning && <Collapsible title="학습 방향">
      <Stack gap="sm">
        <Input label="어떻게 배우고 싶나요?" placeholder="예: 정의부터 깊게, 인증과 동시성의 공식 명세도 함께" value={read(learningDraft) ?? learning.preferences ?? ''} maxLength={1200} disabled={pending} onChange={value => set(learningDraft, value)} />
        <Text muted size="xs">글별 의견과 따로 기억하고, 다음 추천과 보충 설명에 참고합니다.</Text>
        <Row gap="sm" wrap>
          <Button size="sm" variant="ghost" disabled={pending || read(learningDraft) === null} onPress={() => act('theory-preferences', undefined, { text: read(learningDraft) ?? '' })}>학습 방향 저장</Button>
          {read(learningDraft) !== null && <Button size="sm" variant="ghost" disabled={pending} onPress={() => set(learningDraft, null)}>취소</Button>}
        </Row>
      </Stack>
    </Collapsible>}
    {(learning?.history ?? []).filter(item => item.id !== learning?.current?.id).length > 0 && <Collapsible title="읽은 이론">
      <Stack gap="lg">{learning?.history.filter(item => item.id !== learning.current?.id).map(item => <Collapsible key={item.id} title={item.title}>
        <TheoryReading lesson={item} pending={pending} current={false} remaining={0} />
      </Collapsible>)}</Stack>
    </Collapsible>}
  </Stack>
}

export default function Panel() {
  const { snapshot, error } = read(view)
  const pending = read(busy)
  const search = read(query).trim().toLocaleLowerCase()
  const proposals = [...(snapshot?.proposals ?? [])].reverse().filter(item =>
    (item.title + ' ' + item.summary + ' ' + item.repo).toLocaleLowerCase().includes(search))
  const reportSummary = snapshot?.report.trim().split('\n').at(-1) || '아직 보고가 없습니다.'
  const collecting = snapshot?.collection?.status === 'running'
  const judgments = [...(snapshot?.judgments ?? [])].sort((a, b) => priorities[a.priority] - priorities[b.priority])
  const actionable = judgments.filter(item => item.priority !== 'info' && !(snapshot?.reminders ?? []).some(reminder => reminder.id === item.id))
  const progress = (snapshot?.savedTasks ?? []).filter(task => !task.completed)
  const completed = (snapshot?.savedTasks ?? []).filter(task => task.completed)
  const unhealthy = (snapshot?.sourceHealth ?? []).filter(item => item.status === 'failed' || item.status === 'stale' || item.status === 'unknown')
  return <Stack gap="md">
    <Row justify="between" align="center" wrap>
      <Heading level={2}>Ping Inbox</Heading>
      <Button size="sm" variant="ghost" disabled={pending} onPress={refresh}>{pending ? '확인 중…' : '화면 갱신'}</Button>
    </Row>
    {read(section) !== 'theory' && <Row gap="sm" wrap>
      <Button size="sm" disabled={pending || collecting || !snapshot || snapshot.collectionAvailable === false} onPress={() => act('collect')}>{collecting ? '수집 중…' : '지금 보고 받기'}</Button>
      <Text muted size="xs">{snapshot?.collectionAvailable === false ? '설정 파일에 수집 명령을 연결하세요. README에서 시작 방법을 확인할 수 있습니다.' : '연결한 수집기로 새 보고 받기'}</Text>
    </Row>}
    {error && <Stack gap="xs"><Text size="sm">요청을 완료하지 못했습니다. 아래 내용을 확인하고 다시 시도하세요.</Text><Text muted size="xs">{error}</Text></Stack>}
    {!snapshot && !error && <Text muted>알림을 가져오고 있습니다.</Text>}
    {snapshot && <Stack gap="md">
      {read(section) !== 'theory' && <Stack gap="md">
      <Callout tone="neutral" icon="bell">
        <Stack gap="xs">
        {snapshot.collection && <Text size="sm">{snapshot.collection.message}</Text>}
        <Text size="sm">{reportSummary.length > 220 ? reportSummary.slice(0, 220) + '…' : reportSummary}</Text>
        {snapshot.updatedAt > 0 && <Row gap="xs"><Text muted size="xs">마지막 보고</Text><RelativeTime at={snapshot.updatedAt} /></Row>}
        </Stack>
      </Callout>
      <Collapsible title={snapshot.sourceHealth?.length ? `수집 상태 · 확인 필요 ${unhealthy.length}개` : '수집 상태 · 아직 기록 없음'}>
        <Stack gap="md">
          {!(snapshot.sourceHealth ?? []).length && <Text muted size="sm">아직 소스별 상태 기록이 없습니다.</Text>}
          {(snapshot.sourceHealth ?? []).map(source => <Stack key={source.id} gap="xs">
            <Row justify="between" wrap><Text size="sm" weight="semibold">{source.title} · {healthLabels[source.status]}</Text>{source.checkedAt !== null && <RelativeTime at={source.checkedAt} />}</Row>
            <Text muted size="xs">{source.message}</Text>
          </Stack>)}
        </Stack>
      </Collapsible>
      </Stack>}
      <Tabs label="Ping Inbox" value={read(section) ?? 'now'} onChange={value => set(section, value)}>
        <Tab value="now" label="지금">
          <Stack gap="lg">
            {(snapshot.reminders ?? []).length > 0 && <Stack gap="md">
              <Heading level={3}>다시 볼 시간</Heading>
              {(snapshot.reminders ?? []).map(reminder => <Stack key={reminder.id} gap="sm">
                <Text weight="semibold">{reminder.title}</Text>
                <Row gap="sm" wrap>
                  <Button size="sm" variant="outline" disabled={pending} onPress={() => act('unsnooze', reminder.id)}>대기 목록으로</Button>
                  <Button size="sm" variant="ghost" disabled={pending} onPress={() => act('complete', reminder.id)}>완료로 표시</Button>
                  {reminder.url && <Link href={reminder.url}>원문</Link>}
                </Row>
              </Stack>)}
            </Stack>}
            {!snapshot.judgments && <Stack gap="xs"><Text size="sm">아직 우선순위를 판단한 보고가 없습니다.</Text><Text muted size="xs">수집기가 우선순위와 근거를 보내면 이곳에 표시됩니다.</Text></Stack>}
            {snapshot.judgments && <Text muted size="xs">{`급함 ${judgments.filter(item => item.priority === 'urgent').length} · 오늘 ${judgments.filter(item => item.priority === 'today').length} · 참고 ${judgments.filter(item => item.priority === 'info').length} · 판단 보류 ${judgments.filter(item => item.priority === 'unknown').length}`}</Text>}
            {snapshot.judgments && actionable.length === 0 && <Text size="sm">이번 보고에는 바로 처리할 항목이 없습니다.</Text>}
            {actionable.map((item: Judgment) => {
              const proposal = snapshot.proposals.find(proposal => proposal.id === item.id || proposal.title === item.title)
              const { subject, source } = splitTitle(item.title, proposal?.repo, item.url || proposal?.url)
              return <TaskCard key={item.title} title={subject} description={source}>
                <Stack gap="sm">
                <Row gap="sm"><Badge tone={priorityTones[item.priority]}>{priorityLabels[item.priority]}</Badge>{item.manualPriority && <Text muted size="xs">내가 지정</Text>}</Row>
                <Text size="sm">{item.reason}</Text>
                <Text size="sm">권장 · {item.action}</Text>
                {item.id ? <TaskActions id={item.id} proposal={proposal} url={item.url} priority={item.manualPriority ? item.priority : undefined} /> : item.url && <Link href={item.url}>근거</Link>}
                </Stack>
              </TaskCard>
            })}
            {judgments.some(item => item.priority === 'info') && <Collapsible title="참고 알림" description={`${judgments.filter(item => item.priority === 'info').length}건`}>
              <Stack gap="md">{judgments.filter(item => item.priority === 'info').map(item => <Stack key={item.title} gap="xs"><Text size="sm">{item.title}</Text><Text muted size="xs">{item.manualPriority ? '내가 지정 · ' : ''}{item.reason}</Text>{item.id ? <TaskActions id={item.id} url={item.url} priority={item.manualPriority ? item.priority : undefined} /> : item.url && <Link href={item.url}>근거</Link>}</Stack>)}</Stack>
            </Collapsible>}
          </Stack>
        </Tab>
        <Tab value="tasks" label={`대기 ${snapshot.proposals.length}`}>
          <Stack gap="md">
            <Input label="대기 작업 검색" labelHidden type="search" placeholder="제목이나 프로젝트 검색" value={read(query)}
              onChange={value => { set(query, value); set(visible, 8) }} />
            {proposals.length === 0 && <Text muted size="sm">{search ? '검색 결과가 없습니다.' : '대기 중인 일이 없습니다.'}</Text>}
            {proposals.slice(0, read(visible)).map((proposal: Proposal) => <TaskCard key={proposal.id}
              title={splitTitle(proposal.title).subject}
              description={splitTitle(proposal.title, proposal.repo, proposal.url).source}>
              <Stack gap="sm">
                <Text size="sm">{proposal.summary}</Text>
                {proposal.status === 'uncertain' && <Text size="sm">실행 응답을 확인하지 못했습니다. 오르카에서 생성된 작업을 먼저 확인하세요.</Text>}
                {proposal.repo === '~' && <Text muted size="xs">실행할 프로젝트를 먼저 연결해야 합니다.</Text>}
                {proposal.manualPriority && <Text muted size="xs">내가 지정 · {priorityLabels[proposal.priority!]}</Text>}
                <TaskActions id={proposal.id} proposal={proposal} url={proposal.url} priority={proposal.priority} />
              </Stack>
            </TaskCard>)}
            {proposals.length > read(visible) && <Button size="sm" variant="ghost" onPress={() => set(visible, read(visible) + 8)}>이전 작업 더 보기</Button>}
            {(snapshot.snoozed ?? []).length > 0 && <Collapsible title={`나중에 보기 ${(snapshot.snoozed ?? []).length}건`}>
              <Stack gap="md">{(snapshot.snoozed ?? []).map(reminder => <Stack key={reminder.id} gap="sm">
                <Text size="sm" weight="semibold">{reminder.title}</Text>
                <Text muted size="xs">{formatTime(reminder.until, snapshot.timeZone)} 다시 알림 · {snapshot.timeZone ?? '기기 시간대'}</Text>
                <Row gap="sm" wrap><Button size="sm" variant="ghost" disabled={pending} onPress={() => act('unsnooze', reminder.id)}>지금 다시 보기</Button>{reminder.url && <Link href={reminder.url}>원문</Link>}</Row>
              </Stack>)}</Stack>
            </Collapsible>}
            <Text muted size="xs">시작하면 해당 프로젝트에 새 워크트리와 채팅을 엽니다.</Text>
          </Stack>
        </Tab>
        <Tab value="progress" label={`진행 ${progress.length}`}>
          <Stack gap="lg">
            {progress.length === 0 && <Text muted size="sm">아직 시작한 작업이 없습니다.</Text>}
            {progress.map(task => <ProgressTask key={task.id} task={task} />)}
            {completed.length > 0 && <Collapsible title={`완료로 표시한 작업 ${completed.length}건`}><Stack gap="lg">{completed.map(task => <ProgressTask key={task.id} task={task} />)}</Stack></Collapsible>}
            <Text muted size="xs">탭을 닫아도 작업과 세션 기록은 남습니다. 다시 열기는 저장한 대화를 엽니다.</Text>
          </Stack>
        </Tab>
        <Tab value="report" label="최근 보고">
          <Stack gap="lg">
            {!snapshot.report.trim() && <Text muted size="sm">아직 보고가 없습니다.</Text>}
            {snapshot.report.split('\n').map(line => line.trim()).filter(Boolean).map((line, index) =>
              /^#{1,6}\s/.test(line)
                ? <Text key={index} muted size="xs">{line.replace(/^#{1,6}\s+/, '')}</Text>
                : <Markdown key={index} content={line.replace(/^[-*]\s+/, '').replace(/(?<!\S)https?:\/\/\S+/g, url => `[원문](${url})`)} />)}
          </Stack>
        </Tab>
        <Tab value="theory" label="오늘의 이론"><TheoryPanel learning={snapshot.theory} pending={pending} /></Tab>
      </Tabs>
    </Stack>}
  </Stack>
}
