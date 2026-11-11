import { assert, test } from 'orca/testing'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { setTimeout } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectionStatus, requestCollection, runCollection } from './collect.ts'
function fixture() {
  const home=mkdtempSync(join(tmpdir(),'inbox-collect-')); const state=join(home,'state')
  mkdirSync(state)
  writeFileSync(join(state,'config.json'),JSON.stringify({collectorCommand:[process.execPath,join(home,'collector.ts')]}))
  writeFileSync(join(home,'collector.ts'),`console.log(JSON.stringify({report:'예제 보고',judgments:[]}))`)
  return {home,state,close:()=>rmSync(home,{recursive:true,force:true})}
}
test('중복 수집을 막고 JSON 결과를 보고로 저장한다',()=>{
  const f=fixture();let count=0
  try {
    requestCollection(f.state,f.home,()=>{count++});requestCollection(f.state,f.home,()=>{count++})
    assert.equal(count,1)
    runCollection(f.state,f.home,()=>({status:0,stdout:'{}',stderr:''}))
    assert.equal(collectionStatus(f.state)?.status,'complete')
    assert.match(collectionStatus(f.state)?.message??'',/새 알림이 없습니다/)
  }finally{f.close()}
})
test('실패와 잘못된 JSON을 정상 수집으로 표시하지 않는다',()=>{
  for(const result of [{status:1,stdout:'',stderr:'failure'},{status:0,stdout:'invalid',stderr:''}]) {
    const f=fixture()
    try {requestCollection(f.state,f.home,()=>{});runCollection(f.state,f.home,()=>result);assert.equal(collectionStatus(f.state)?.status,'failed')}
    finally{f.close()}
  }
})
test('실제 백그라운드 프로세스는 개인 스크립트 없이 실행하고 잠금을 푼다',async()=>{
  const f=fixture()
  try {
    requestCollection(f.state,f.home)
    for(let i=0;i<100;i++) {
      if(collectionStatus(f.state)?.status==='complete'&&!existsSync(join(f.state,'manual-collection.lock')))break
      await setTimeout(50)
    }
    assert.equal(collectionStatus(f.state)?.status,'complete')
    assert.equal(existsSync(join(f.state,'report.md')),true)
    assert.equal(existsSync(join(f.state,'manual-collection.lock')),false)
  }finally{f.close()}
})
test('강제 종료한 작업의 잠금을 임의로 풀지 않는다',()=>{
  const f=fixture()
  try{
    requestCollection(f.state,f.home,()=>{})
    writeFileSync(join(f.state,'manual-collection.json'),JSON.stringify({status:'running',pid:2147483647,startedAt:1,message:''}))
    assert.equal(collectionStatus(f.state)?.status,'failed')
    assert.throws(()=>requestCollection(f.state,f.home,()=>{}),/needs recovery/)
  }finally{f.close()}
})
