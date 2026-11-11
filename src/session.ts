import { createConnection } from 'node:net'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

export type RevealedSession = { sessionId: string; workspaceId: string; agent: string }

// Orca 1.4.248의 로컬 NDJSON RPC. 공식 CLI에 reveal이 없으므로 같은 호스트 API만 사용한다.
// API가 바뀌면 명시적으로 실패한다. 새 대화나 새 워크트리로 대체하지 않는다.
export async function callReveal(sessionId: string, home = homedir(), timeoutMs = 15_000, metadataPath?: string): Promise<RevealedSession> {
  if (!/^[\w:.-]{1,200}$/.test(sessionId)) throw new Error('Invalid saved session ID')
  const file = metadataPath ?? [join(home, '.config/orca/orca-runtime.json'), join(home, '.config/Orca/orca-runtime.json'), join(home, 'Library/Application Support/Orca/orca-runtime.json')].find(existsSync) ?? join(home, '.config/orca/orca-runtime.json')
  const info = lstatSync(file)
  if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) throw new Error('Runtime metadata is not private to this user')
  const metadata = JSON.parse(readFileSync(file, 'utf8'))
  const endpoint = metadata.transports?.find((item: { kind: string }) => item.kind === 'unix')?.endpoint
  if (typeof endpoint !== 'string' || typeof metadata.authToken !== 'string') throw new Error('Local Orca runtime is unavailable')
  const directory = lstatSync(dirname(endpoint))
  const target = lstatSync(endpoint)
  if (!directory.isDirectory() || directory.uid !== info.uid || (directory.mode & 0o077) !== 0 || !target.isSocket() || target.uid !== info.uid) throw new Error('Runtime socket is not private to this user')
  const socket = createConnection(endpoint)
  socket.setEncoding('utf8')
  socket.setTimeout(timeoutMs, () => socket.destroy(new Error('Session reopen timed out')))
  const lines = createInterface({ input: socket, crlfDelay: Infinity })
  const id = randomUUID()
  try {
    await once(socket, 'connect')
    socket.write(JSON.stringify({ id, authToken: metadata.authToken, method: 'agentSession.reveal', params: { sessionId } }) + '\n')
    for await (const line of lines) {
      if (line.length > 1024 * 1024) throw new Error('Runtime response is too large')
      const frame = JSON.parse(line)
      if (frame._keepalive) continue
      if (frame.id !== id || (frame._meta?.runtimeId && frame._meta.runtimeId !== metadata.runtimeId)) throw new Error('Runtime response identity mismatch')
      if (!frame.ok) throw new Error(frame.error?.message ?? 'Session reopen failed')
      if (!frame.result?.ok) throw new Error(frame.result?.refusal?.message ?? 'Saved session is unavailable')
      if (frame.result.readable === false) throw new Error('Saved chat transcript is not readable')
      if (frame.result.sessionId !== sessionId || typeof frame.result.workspaceId !== 'string') throw new Error('Saved session identity mismatch')
      return { sessionId, workspaceId: frame.result.workspaceId, agent: frame.result.agent }
    }
    throw new Error('Runtime closed before acknowledging the session')
  } finally { lines.close(); socket.destroy() }
}

export function revealSession(sessionId: string, metadataPath?: string) {
  return JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--reveal', sessionId, ...(metadataPath ? [metadataPath] : [])], {
    encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024,
  })) as RevealedSession
}

if (process.argv[1] && existsSync(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    if (process.argv[2] !== '--reveal') throw new Error('Invalid session invocation')
    console.log(JSON.stringify(await callReveal(process.argv[3], homedir(), 15_000, process.argv[4])))
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
}
