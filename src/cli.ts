import { parseArgs } from 'node:util'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { config, defaultState, expandHome } from './config.ts'
import { publish } from './publish.ts'
import { bridge } from './bridge.ts'
import { requestCollection } from './collect.ts'
import { homedir } from 'node:os'
try {
  const {values,positionals}=parseArgs({allowPositionals:true,options:{state:{type:'string'},collector:{type:'string'}}})
  const state=expandHome(values.state || defaultState())
  config(state)
  const action=positionals[0]
  if(values.collector && action!=='init') throw new Error('--collector is only supported by init')
  if(action==='init'){
    if(values.collector && !['demo','github'].includes(values.collector)) throw new Error('Collector must be demo or github')
    const settings=config(state)
    if(values.collector) settings.collectorCommand=[process.execPath,fileURLToPath(new URL(`../examples/${values.collector==='demo'?'collector':'github'}.ts`,import.meta.url))]
    mkdirSync(state,{recursive:true,mode:0o700})
    writeFileSync(join(state,'config.json'),JSON.stringify(settings,null,2)+'\n',{flag:'wx',mode:0o600})
    console.log('Created '+join(state,'config.json'))
  }else if(action==='publish') publish(state,readFileSync(0,'utf8'))
  else if(action==='learning-demo') {
    const source=fileURLToPath(new URL('../examples/lessons',import.meta.url))
    const target=join(state,'lessons')
    mkdirSync(target,{recursive:true,mode:0o700})
    for(const file of readdirSync(source).filter(file=>file.endsWith('.md'))) {
      if(!existsSync(join(target,file))) writeFileSync(join(target,file),readFileSync(join(source,file)),{flag:'wx',mode:0o600})
    }
    console.log('Added example lessons; existing learning data was preserved')
  }
  else if(action==='demo') publish(state,execFileSync(process.execPath,[fileURLToPath(new URL('../examples/collector.ts',import.meta.url))],{encoding:'utf8'}))
  else if(action==='collect') requestCollection(state,homedir())
  else if(action==='status') console.log(JSON.stringify(bridge({action:'snapshot'},state),null,2))
  else throw new Error('Usage: node src/cli.ts init|publish|demo|collect|status|learning-demo [--state /absolute/path] [--collector demo|github]')
}catch(error){ console.error(error instanceof Error ? error.message : String(error));process.exitCode=1 }
