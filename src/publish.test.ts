import { assert, test } from 'orca/testing'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publish } from './publish.ts'
import { bridge } from './bridge.ts'
test('수집기는 별칭으로만 프로젝트를 연결하고 같은 링크의 제목 변경은 세션 식별자를 보존한다',()=>{
 const state=mkdtempSync(join(tmpdir(),'inbox-publish-'))
 try{
  writeFileSync(join(state,'config.json'),JSON.stringify({repositories:{example:'~/projects/example'}}))
  const task={title:'검토 요청',repository:'example',url:'https://example.com/task',summary:'확인',instructions:'실행하지 않은 검토'}
  publish(state,JSON.stringify({report:'보고',proposals:[task],judgments:[{title:task.title,priority:'today',reason:'응답 대기',action:'검토',url:task.url}]}))
  const first=bridge({action:'snapshot'},state)
  assert.equal(first.proposals.length,1)
  assert.equal(first.proposals[0].repo.endsWith('/projects/example'),true)
  publish(state,JSON.stringify({proposals:[{...task,title:'바뀐 제목'}]}))
  assert.equal(bridge({action:'snapshot'},state).proposals[0].id,first.proposals[0].id)
  const modified=statSync(join(state,'report.md')).mtimeMs
  publish(state,JSON.stringify({sources:[]}))
  assert.equal(statSync(join(state,'report.md')).mtimeMs,modified)
  assert.throws(()=>publish(state,JSON.stringify({proposals:[{...task,title:'bad | row'}]})))
  assert.throws(()=>publish(state,JSON.stringify({judgments:[]})))
  assert.throws(()=>publish(state,JSON.stringify({report:'x'.repeat(140000)})),/128 KiB/)
  assert.equal(readFileSync(join(state,'report.md'),'utf8'),'보고')
  assert.equal(existsSync(join(state,'publish.lock')),false)
 }finally{rmSync(state,{recursive:true,force:true})}
})
