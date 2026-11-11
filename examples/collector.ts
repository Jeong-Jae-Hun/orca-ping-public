// 실제 계정에 접속하지 않는 데모 수집기입니다. stdout에는 JSON 하나만 출력합니다.
console.log(JSON.stringify({
  report: '# 예제 보고\n\n검토를 기다리는 작업이 1건 있습니다.',
  proposals: [{ title: '예제 변경 검토', repository: 'example', url: 'https://example.com/tasks/42', summary: '가상의 검토 요청입니다.', instructions: '변경 내용을 읽고 검토 결과를 정리하세요. 외부에 답변을 전송하지 마세요.' }],
  judgments: [{ title: '예제 변경 검토', priority: 'today', reason: '응답을 기다리는 예제 작업입니다.', action: '프로젝트를 연결한 뒤 검토하세요.', url: 'https://example.com/tasks/42' }],
  sources: [{ id: 'demo', title: '예제 수집기', status: 'ok', checkedAt: Date.now(), message: '실제 계정에 접속하지 않았습니다.' }],
}))
