import { assert, test } from 'orca/testing'
import { createServer } from 'node:net'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { callReveal } from './session.ts'

type Request = { id: string; method: string; authToken: string; params: { sessionId: string } }
async function fixture(answer: (request: Request) => object) {
  const home = mkdtempSync(join(tmpdir(), 'ping-session-'))
  const directory = join(home, '.config/orca')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const endpoint = join(directory, 'runtime.sock')
  const requests: Request[] = []
  const server = createServer(socket => {
    socket.setEncoding('utf8')
    socket.once('data', data => {
      const request = JSON.parse(String(data)) as Request
      requests.push(request)
      socket.write('{"_keepalive":true}\n')
      const response = JSON.stringify({ id: request.id, ok: true, result: answer(request), _meta: { runtimeId: 'fixture-runtime' } })
      socket.write(response.slice(0, 12))
      setImmediate(() => socket.end(response.slice(12) + '\n'))
    })
  })
  server.listen(endpoint); await once(server, 'listening')
  chmodSync(endpoint, 0o600)
  const file = join(directory, 'orca-runtime.json')
  writeFileSync(file, JSON.stringify({ runtimeId: 'fixture-runtime', authToken: 'fixture-only', transports: [{ kind: 'unix', endpoint }] }), { mode: 0o600 })
  return { home, file, requests, close: async () => { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(home, { recursive: true, force: true }) } }
}

test('저장한 같은 세션을 NDJSON RPC로 복원하고 새 세션은 만들지 않는다', async () => {
  const f = await fixture(request => ({ ok: true, sessionId: request.params.sessionId, workspaceId: 'test-worktree', agent: 'claude', readable: true }))
  try {
    assert.deepEqual(await callReveal('saved-chat', f.home), { sessionId: 'saved-chat', workspaceId: 'test-worktree', agent: 'claude' })
    assert.deepEqual(f.requests.map(item => item.method), ['agentSession.reveal'])
    assert.equal(f.requests[0].params.sessionId, 'saved-chat')
  } finally { await f.close() }
})

test('없어진 대화는 오류로 표시하고 새로운 대화로 대체하지 않는다', async () => {
  const f = await fixture(() => ({ ok: false, refusal: { message: 'Saved session missing' } }))
  try { await assert.rejects(callReveal('missing-chat', f.home), /Saved session missing/); assert.equal(f.requests.length, 1) }
  finally { await f.close() }
})

test('다른 사용자가 읽을 수 있는 메타데이터에서는 인증 정보를 보내지 않는다', async () => {
  const f = await fixture(() => ({}))
  try { chmodSync(f.file, 0o644); await assert.rejects(callReveal('saved-chat', f.home), /not private/); assert.equal(f.requests.length, 0) }
  finally { await f.close() }
})

test('복원 응답이 다른 대화를 가리키면 성공으로 처리하지 않는다', async () => {
  const f = await fixture(() => ({ ok: true, sessionId: 'another-chat', workspaceId: 'test-worktree', agent: 'claude', readable: true }))
  try { await assert.rejects(callReveal('saved-chat', f.home), /identity mismatch/) }
  finally { await f.close() }
})
