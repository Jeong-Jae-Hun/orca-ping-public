import { assert, test } from 'orca/testing'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sourceHealth } from './health.ts'
test('수집기 기록이 없으면 임의의 소스를 정상으로 만들지 않는다', () => {
  const state=mkdtempSync(join(tmpdir(),'inbox-health-'))
  try {
    assert.deepEqual(sourceHealth(state),[])
    const now=Date.now()
    writeFileSync(join(state,'source-health.json'),JSON.stringify([
      {id:'a',title:'예제 A',status:'ok',checkedAt:now-3*60*60*1000,message:''},
      {id:'b',title:'예제 B',status:'failed',checkedAt:now-3*60*60*1000,message:''},
      {id:'c',title:'예제 C',status:'skipped',checkedAt:now,message:''},
    ]))
    assert.deepEqual(sourceHealth(state,now).map(v=>v.status),['stale','failed','skipped'])
    writeFileSync(join(state,'source-health.json'),'{broken')
    assert.equal(sourceHealth(state)[0].status,'unknown')
  } finally { rmSync(state,{recursive:true,force:true}) }
})
