import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, existsSync, writeFileSync, renameSync, rmdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { z } from '../vendor/schema.js'
import { config, repositoryPath } from './config.ts'
const title = z.string().min(1).max(200).regex(/^[^\r\n|]+$/)
const url = z.string().max(2000).refine(v => !v || /^https?:\/\/[^\s|]+$/.test(v)).default('')
const grade = z.enum(['urgent','today','info','unknown'])
const schema = z.object({
  report: z.string().max(50000).optional(),
  proposals: z.array(z.object({ title, repository: z.string().max(200).optional(), url, summary: z.string().max(1000), instructions: z.string().max(16000) }).strict()).max(50).optional(),
  judgments: z.array(z.object({ title, priority: grade, reason: z.string().max(2000), action: z.string().max(1000), url }).strict()).max(50).optional(),
  sources: z.array(z.object({ id: title, title, status: z.enum(['ok','failed','skipped','unknown']), checkedAt: z.number().positive().max(Date.now()+60000), message: z.string().max(1000).default('') }).strict()).max(50).optional(),
}).strict().refine(v => v.judgments === undefined || v.report !== undefined, { message: 'Judgments require a report' })
const hash = (v: string) => createHash('sha1').update(v).digest('hex').slice(0,8)
const cell = (v: string) => v.replace(/[\r\n|]+/g, ' ')
const atomic = (file: string, text: string) => { writeFileSync(file+'.tmp', text, { mode: 0o600 }); renameSync(file+'.tmp',file) }
export function publish(state: string, input: string) {
  if (Buffer.byteLength(input) > 128*1024) throw new Error('Collector output exceeds 128 KiB')
  const settings = config(state)
  const data = schema.parse(JSON.parse(input))
  mkdirSync(state,{recursive:true,mode:0o700})
  const lock = join(state,'publish.lock')
  mkdirSync(lock)
  try {
    mkdirSync(join(state,'prompts'),{recursive:true,mode:0o700})
    const file = join(state,'proposals.md')
    const rows = existsSync(file) ? readFileSync(file,'utf8').split('\n').filter(Boolean) : []
    for (const item of data.proposals ?? []) {
      const index = rows.findIndex(row => { const cells = row.split(' | '); return cells[0] === item.title || (item.url && cells[2] === item.url) })
      const stableTitle = index >= 0 ? rows[index].split(' | ')[0] : item.title
      const repo = item.repository && settings.repositories[item.repository] ? repositoryPath(settings.repositories[item.repository]) : '~'
      const row = [stableTitle,repo,item.url,cell(item.summary),cell(item.instructions)].join(' | ')
      if (index >= 0) rows[index]=row; else rows.push(row)
      atomic(join(state,'prompts',hash(stableTitle)+'.md'),item.summary+'\n\n'+item.instructions)
    }
    if (data.proposals) atomic(file,rows.join('\n')+'\n')
    if (data.report !== undefined) {
      const reportFile=join(state,'report.md')
      if (!existsSync(reportFile) || readFileSync(reportFile,'utf8') !== data.report) atomic(reportFile,data.report)
      if (data.judgments) atomic(join(state,'briefing.json'),JSON.stringify({batch:hash(data.report),items:data.judgments}))
      else if (existsSync(join(state,'briefing.json'))) unlinkSync(join(state,'briefing.json'))
    }
    if (data.sources) atomic(join(state,'source-health.json'),JSON.stringify(data.sources))
  } finally { rmdirSync(lock) }
}
