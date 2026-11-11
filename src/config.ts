import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from '../vendor/schema.js'

export const defaultState = () => process.env.PING_INBOX_STATE || join(homedir(), '.local/state/ping-inbox')
export const expandHome = (path: string, home = homedir()) => path === '~' ? home : path.startsWith('~/') ? join(home, path.slice(2)) : path
export const runtimeEnv = () => ({ ...process.env, PATH: [join(homedir(), '.local/bin'), join(homedir(), '.volta/bin'), '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH].join(':') })
const schema = z.object({
  collectorCommand: z.array(z.string().min(1)).max(32).default([]),
  collectorCwd: z.string().default(''), repositories: z.record(z.string(), z.string()).default({}),
  agent: z.enum(['claude', 'codex']).default('claude'),
  timeZone: z.string().refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false } }).default(Intl.DateTimeFormat().resolvedOptions().timeZone),
  orcaExecutable: z.string().min(1).default('orca'), runtimeMetadataPath: z.string().default(''),
}).strict()
export function config(state: string) {
  const root = resolve(state)
  const checkout = resolve(fileURLToPath(new URL('../', import.meta.url)))
  if (root === checkout || root.startsWith(checkout + '/')) throw new Error('State directory must be outside the plugin checkout')
  const file = join(state, 'config.json')
  return schema.parse(existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {})
}
export function repositoryPath(value: string, home = homedir()) {
  const path = expandHome(value, home)
  if (!isAbsolute(path)) throw new Error('Repository path must be absolute or home-relative')
  return path
}
