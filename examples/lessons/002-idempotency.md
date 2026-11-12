# HTTP 멱등성 · 재시도가 같은 효과를 낼까

주제: 공식 명세 · HTTP
상태: 읽기 전
추천 순서: 0
추천 이유: 논리의 기초를 공식 명세와 연결하는 예제 글입니다.
읽은 시각: —

## Reading

RFC 9110 defines idempotence by the intended server effect of repeated identical requests. It does not require identical responses. A timeout alone does not tell a caller whether the server already performed the operation.

## 한국어 해설

공식 근거는 Internet Standard인 RFC 9110 §9.2.2입니다. 의도한 서버 효과를 비교하며 응답 메시지까지 같다고 요구하지 않습니다.

삭제 요청의 응답이 처음에는 성공이고 다음에는 찾을 수 없음이어도 의도한 삭제 효과는 같을 수 있습니다. 이 사례는 직접 작성한 적용 설명입니다.

## 생각해 볼 질문

지급 요청의 응답을 받지 못했습니다. 재시도 전에 어떤 처리 기록과 보장을 확인할까요?

## 출처

공식 원문: [RFC 9110 §9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2). 영어 글은 직접 작성한 요약입니다.

## 내 의견
아직 없습니다.
