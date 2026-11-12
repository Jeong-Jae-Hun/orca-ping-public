# Ping Inbox

개인 수집기가 만든 보고와 작업 제안을 Orca 데스크톱에서 확인하는 플러그인입니다. 실제 계정 정보나 수집 결과 없이 배포합니다. 수집 명령과 프로젝트 경로는 각 사용자가 로컬에서 설정합니다.

GitHub CLI로 본인의 리뷰 요청·멘션·담당 배정 알림을 읽는 수집기가 포함됩니다. Slack·메일 등은 JSON을 출력하는 별도 스크립트나 에이전트를 연결합니다. 우선순위 판단도 수집기가 보내며, 플러그인은 근거와 권장 행동을 표시합니다.

## 맥 한 대로 시작하기

맥만 있으면 수집·저장·패널·작업 세션을 모두 로컬에서 실행할 수 있습니다. WSL이나 SSH 서버는 필요하지 않습니다. 플러그인 연결 설정의 기본값은 `mode=local`입니다. 아래 명령은 macOS 터미널에서 실행합니다.

Node.js 22.18 이상, Orca 앱과 CLI, GitHub CLI를 먼저 준비합니다. GitHub CLI의 `gh auth login`으로 본인 계정에 로그인합니다. GitHub 알림 API는 fine-grained PAT를 지원하지 않으므로 GitHub CLI OAuth 로그인이나 알림 조회 권한이 있는 classic PAT가 필요합니다. 인증 정보는 각자의 GitHub CLI에 보관합니다.

```sh
git clone https://github.com/Jeong-Jae-Hun/orca-ping-public.git "$HOME/Projects/ping-inbox"
cd "$HOME/Projects/ping-inbox"
gh auth login
node src/cli.ts init --collector github
orca plugin install https://github.com/Jeong-Jae-Hun/orca-ping-public --json
node src/cli.ts collect
```

Orca의 신뢰된 워커 승인 안내를 확인한 뒤 설치합니다. 패널에서 ‘화면 갱신’을 누르면 수집 결과가 보입니다. 다음부터 ‘지금 보고 받기’로 다시 수집할 수 있습니다. 수집기는 이 복제본에 있으므로 폴더를 유지합니다. 기본 데이터 폴더에 이미 설정이 있다면 `init`은 거부하며 기존 값을 보존합니다. 그때는 아래 수집기 설정 형식으로 직접 연결합니다.

GitHub 수집기는 직접 관련된 미독 알림 중 최신 20개를 표시합니다. GitHub의 읽음 상태를 바꾸거나 댓글·승인·머지를 실행하지 않습니다. PR·이슈의 현재 완료 여부는 작업을 시작할 때 확인합니다. 계정 연결 없이 먼저 보려면 `init --collector demo`를 사용합니다.

리뷰 작업까지 실행하려면 로컬 `config.json`의 `repositories`에 `"owner/repository": "~/Projects/repository"`를 등록합니다. 등록 전에는 알림과 원문을 볼 수 있지만 ‘세션 시작’은 비활성입니다. 작업 에이전트도 각자 준비하며 기본은 Claude, Codex는 `agent=codex`로 고릅니다.

수집 예약은 자동으로 만들지 않습니다. 주기적으로 받고 싶으면 자신의 맥에서 Orca 오토메이션이나 다른 예약 도구로 아래 명령을 실행합니다. 다른 사람에게 공유할 때는 이 저장소 URL과 이 절의 설치 순서를 전달하면 됩니다. 개인 설정·토큰·수신함은 복사하지 않습니다.

```sh
node "$HOME/Projects/ping-inbox/src/cli.ts" collect
```

알림 팝업 정책은 기존 공개판 동작을 따릅니다. 개인용 비서 핑의 계정·수집 설정과는 별도이며 현재 사용 중인 WSL 연결을 바꾸지 않습니다.

## 설치와 첫 실행

macOS 또는 Linux, Orca 1.4.248 이상, PATH에서 실행 가능한 Node.js 22.18 이상과 Orca CLI가 필요합니다. Windows에서는 Linux/WSL 백엔드와 SSH 연결을 사용합니다.

1. 이 페이지의 Git URL을 복사해서 Orca의 플러그인 설치 화면에 입력합니다. CLI에서는 `orca plugin install <Git-URL> --json`을 사용합니다.
2. Orca가 표시하는 권한과 신뢰된 워커 실행 안내를 읽고 설치합니다.
3. 상태바의 `핑`이나 오른쪽 알림 패널에서 엽니다. 처음에는 빈 목록이 표시됩니다.

플러그인은 설치만으로 외부 계정에 접속하지 않습니다. 별도 웹 서버도 필요하지 않습니다. 기본 데이터 폴더는 `~/.local/state/ping-inbox`입니다.

예제부터 시험하거나 수집기를 개발하려면 이 저장소를 별도로 복제합니다. 아래 명령은 복제한 저장소 루트에서 실행합니다. 배포판에는 런타임 의존성이 포함돼 있어 다음 명령에 `npm install`이 필요하지 않습니다.

```sh
node src/cli.ts init --collector demo
node src/cli.ts demo
node src/cli.ts status
```

예제는 실제 서비스에 접속하지 않습니다. 패널에서 `화면 갱신`을 누르면 가상의 검토 요청이 나타납니다. 수집 상태, 보고서, 우선순위, 나중에 보기 기능을 확인할 수 있습니다. 아직 프로젝트를 연결하지 않았으므로 `세션 시작`은 비활성 상태입니다.

`init`은 기존 설정 파일을 덮어쓰지 않습니다. 데모를 기존 수신함과 분리하려면 모든 CLI 명령에 `--state /절대경로`를 붙이고 플러그인 설정의 `stateDirectory`도 같은 경로로 지정합니다.

## 수집기와 프로젝트 연결

`~/.local/state/ping-inbox/config.json`을 수정합니다. 실행 명령은 셸 문자열이 아닌 인자 배열입니다. 비밀 키는 이 파일이나 저장소에 넣지 말고 수집기에서 운영체제의 자격 증명 저장소 등을 사용하세요.

```json
{
  "collectorCommand": ["node", "~/projects/ping-inbox/examples/collector.ts"],
  "repositories": { "example": "~/projects/my-project" },
  "agent": "codex",
  "timeZone": "Asia/Seoul"
}
```

경로는 본인의 복제 위치와 Git 저장소 루트에 맞춥니다. 해당 프로젝트를 Orca에도 등록합니다. 새 작업의 기본 에이전트는 `codex`이며 명시적으로 고른 `claude` 설정과 기존 세션의 다시 열기는 유지합니다. 예제를 다시 수집하면 `example` 별칭이 실제 프로젝트와 연결됩니다.

`지금 보고 받기`는 설정한 수집 명령을 백그라운드에서 실행합니다. `화면 갱신`은 저장된 결과만 읽습니다. 다른 앱이나 예약 작업에서 직접 결과를 넣을 수도 있습니다.

```sh
node examples/collector.ts | node src/cli.ts publish
node src/cli.ts collect
```

외부 예약 작업은 `collect`를 통해 같은 수집 잠금을 사용하세요. 플러그인 자체는 수집 일정을 만들지 않습니다. 패널은 저장된 결과를 1분마다 읽습니다.

수집기는 종료 코드 0과 stdout의 JSON 객체 하나를 반환해야 합니다. 일반 로그는 stderr로 출력합니다. 실패하거나 JSON이 잘못되면 기존 보고를 보존하고 실패 상태를 표시합니다. 명령 실행 제한은 약 10분이고, JSON은 UTF-8 기준 최대 128 KiB입니다.

```json
{
  "report": "# 새 보고\n검토를 기다리는 작업이 있습니다.",
  "proposals": [{
    "title": "변경 검토",
    "repository": "example",
    "url": "https://example.com/tasks/42",
    "summary": "검토할 변경과 영향을 짧게 설명합니다.",
    "instructions": "작업 세션에 전달할 구체적인 요청입니다."
  }],
  "judgments": [{
    "title": "변경 검토",
    "priority": "today",
    "reason": "작성자가 검토를 기다립니다.",
    "action": "변경을 읽고 검토 결과를 정리하세요.",
    "url": "https://example.com/tasks/42"
  }],
  "sources": [{
    "id": "example",
    "title": "예제 수집기",
    "status": "ok",
    "checkedAt": 1794394800000,
    "message": "조회를 완료했습니다."
  }]
}
```

각 최상위 필드는 생략할 수 있습니다. `judgments`를 보내면 같은 JSON에 `report`도 있어야 합니다. `proposals`, `judgments`, `sources`는 각각 최대 50개입니다. 제목은 200자 이하이며 줄바꿈과 `|`를 허용하지 않습니다. 링크는 HTTP(S)만 허용합니다. `checkedAt`은 실제 조회 시각의 Unix 밀리초로 갱신합니다.

우선순위는 `urgent`(급함), `today`(오늘), `info`(참고), `unknown`(판단 보류)입니다. 판단 근거가 부족하면 `unknown`으로 보내세요. 참고 알림만 있는 보고는 팝업을 보내지 않습니다. 수집 상태는 `ok`, `failed`, `skipped`, `unknown`을 받으며 2시간이 지난 결과는 오래된 기록으로 표시합니다.

새 제안은 기존 대기 목록에 합칩니다. 같은 제목 또는 비어 있지 않은 같은 URL은 기존 식별자를 유지합니다. 서로 다른 일에는 고유한 제목과 URL을 사용하세요. 제안을 생략했다고 기존 작업을 지우지는 않습니다. `sources`는 소스 상태 전체 목록을 교체합니다. 소스 상태만 보낼 때는 이전 보고 시각을 갱신하지 않습니다.

## 작업 이어가기

`세션 시작`은 설정된 Git 프로젝트 루트에 부모가 연결된 새 워크트리와 작업 채팅을 만듭니다. 수집기가 전달한 임의의 경로를 직접 실행하지 않고, 로컬 설정의 프로젝트 별칭으로 연결합니다. 요약과 지시문은 에이전트에 전달되므로 신뢰할 수 있는 수집기를 사용하세요.

시작한 작업은 `진행` 탭에 남습니다. `다시 열기`는 저장한 워크트리와 같은 세션 ID의 대화를 엽니다. 최초 요청을 다시 보내지 않습니다. `완료로 표시`해도 대화와 워크트리를 삭제하지 않습니다. Orca의 대화 기록이나 워크트리 자체가 사라졌다면 복원할 수 없습니다.

`나중에 보기 · 우선순위`에서 1시간 뒤 또는 설정한 시간대의 내일 오전 9시에 다시 알리도록 정할 수 있습니다. 앱이 꺼져 있었다면 다음 연결 때 표시합니다. 직접 고친 우선순위는 유지되며 `자동 판단`으로 되돌릴 수 있습니다.

새 보고 팝업과 미룬 알림의 중복 방지는 기기별로 관리합니다. 여러 기기가 같은 백엔드에 연결하면 대기 목록과 실행 기록을 공유하지만, 팝업은 각 기기에 표시될 수 있습니다.

## 오늘의 이론

인박스는 제목·출처·우선순위·권장 행동을 작업 카드로 묶습니다. ‘오늘의 이론’ 탭은 읽는 글을 중심에 두고 의견·추천 이유·학습 방향을 접어 둡니다.

다음 명령으로 개인 데이터가 없는 예제 글 두 개를 추가합니다. 기존 글과 읽은 상태는 덮어쓰지 않습니다. 예제는 논리의 기초와 HTTP 명세를 다루며 다른 주제의 글로 바꿔도 됩니다.

```sh
node src/cli.ts learning-demo
```

‘읽었어요’를 눌러야 읽음으로 기록합니다. ‘학습 방향’에는 원하는 깊이와 분야를 적으며 글별 의견과 따로 저장합니다. ‘더 기초부터’와 ‘반례 보기’는 원문과 읽음 기록을 바꾸지 않고 짧은 AI 설명을 덧붙입니다. 공식 근거와 AI 설명을 구별하며 읽음 기록을 이해도 평가로 취급하지 않습니다.

AI 호출은 기본으로 꺼져 있습니다. 추천과 보충 설명을 쓰려면 백엔드 머신에서 사용할 Codex 또는 Claude CLI에 로그인하고 `config.json`의 `learning`에 `engine`과 실제 사용할 `model` ID를 지정합니다. `engine`은 `off`, `codex`, `claude` 중 하나입니다. 모델을 지정하지 않은 활성 설정은 거부합니다.

글은 데이터 폴더의 `lessons/*.md`에 둡니다. 파일명은 영문 소문자·숫자·하이픈으로 짓고 예제의 머리말 형식을 따릅니다. 추천 순서 0은 미추천 후보이며 가장 큰 순서가 현재 글입니다. 학습 방향은 `theory-preferences.json`, 마지막 AI 설명은 `theory-explanation.json`에 저장합니다. 생성 실패나 두 기기의 동시 학습으로 현재 글이 달라지면 기존 읽기 기록을 보존합니다.

## 명세 진행

`명세` 탭은 작업 중인 구현 명세의 단계별 진행과 연결된 Orca 세션을 보여 줍니다. 기본은 꺼져 있으며 `config.json`에 아래처럼 켭니다. 켜면 Orca 세션 목록과 GitHub CLI(`gh`)로 PR 상태를 읽습니다.

```json
{ "specs": { "enabled": true, "roots": ["~/notes/specs"], "repos": ["~/Projects/app"], "docs": ["docs"] } }
```

`roots`는 내가 쓰는 명세 폴더이고 그 아래 Markdown을 세 단계까지 읽습니다. `repos`와 실행 중인 Orca 세션의 워크트리에서는 `docs`에 적은 폴더를 읽습니다.

문서 머리(frontmatter)에 `spec: active`를 적으면 추적합니다. 표시가 없어도 문서가 내 열린 PR이나 세션이 붙은 PR을 가리키면 자동으로 잡습니다. 세션 브랜치에서 고친 레포 문서 가운데 경로에 spec·plan이 든 것도 자동으로 잡습니다. `spec: done`·`spec: off`는 뺍니다.

`##` 소제목 가운데 PR 참조(`owner/repo#N`, PR 주소)나 체크박스가 있는 절이 단계입니다. 카드에는 모든 단계의 흐름과 PR마다 드래프트·리뷰·승인·머지 중 지금 위치, CI 결과가 보입니다. 본문은 항목 첫 줄로 줄여 보이고 원문은 접어 둡니다. `세션 열기`는 연결된 Orca 세션의 기존 대화를 엽니다.

`백로그로`는 명세를 진행 목록에서 빼서 「백로그」로 옮깁니다. `roots` 문서는 frontmatter의 `spec:` 한 줄만 바꾸고, 레포 문서는 고치지 않고 데이터 폴더의 `spec-status.json`에 남깁니다. `완료`는 같은 방식으로 `done`을 남기고 「완료」 묶음으로 옮깁니다. SSH 백엔드에서는 세션 열기가 이 Orca 화면에서도 같은 경로의 워크스페이스를 엽니다(`workspace:read`·`workspace:write` 권한). 명세에 붙지 않은 활동 세션은 「명세 없는 세션」에 상태와 마지막 응답 한 줄로 보입니다. PR 상태는 180초 동안 재사용합니다.

## SSH 백엔드

데스크톱과 프로젝트가 다른 머신에 있을 때 사용합니다. 백엔드 머신에도 이 저장소, Node.js, 실행 가능한 Orca CLI가 있어야 하고, 복원할 세션을 소유한 Orca 런타임이 실행 중이어야 합니다. 먼저 일반 터미널에서 비대화식 SSH 로그인이 되는지 확인합니다.

Orca의 플러그인 설정에서 다음 값을 지정합니다.

| 설정 | 값 |
| --- | --- |
| `mode` | `ssh` |
| `sshHost` | 본인의 SSH config 호스트 별칭 |
| `backendEntry` | 백엔드의 `~/projects/ping-inbox/src/bridge.ts` |
| `stateDirectory` | 비워 두면 백엔드의 기본 데이터 폴더 |
| `nodeExecutable` | `node` 또는 백엔드의 Node 실행 파일 |

로컬 실행은 `mode=local`이며 `backendEntry`를 비워 두면 설치된 플러그인의 백엔드를 사용합니다. `orcaExecutable`은 데스크톱의 CLI 경로입니다. 백엔드에서 실행할 CLI 경로는 데이터 폴더의 `config.json`에서 지정합니다. 여러 사본을 설치해 상태바 열기 대상을 고를 수 없다면 설정의 `pluginKey`에 `orca plugin list --json`에 표시된 키를 입력합니다.

## 데이터와 권한

이 플러그인은 `trusted-worker`입니다. 자체 저장소·설정·데스크톱 알림 권한 외에도 Node 프로세스가 현재 사용자의 파일과 프로세스에 접근할 수 있습니다. 설정한 수집 명령을 실행하고, 세션 시작 시 Orca CLI를 호출하며, SSH 모드에서는 지정한 호스트에 접속합니다. 네이티브 권한 목록을 파일 접근 샌드박스로 해석하면 안 됩니다.

보고, 지시문, 작업 식별자, 개인 경로와 학습 기록은 데이터 폴더에 저장합니다. 최근 보고의 사본과 알림 중복 방지 기록은 Orca의 플러그인 저장소에도 남습니다. 외부 분석 기능은 없습니다. 학습 AI를 켜고 추천이나 보충 설명을 요청하면 관련 글·의견·학습 방향을 설정한 CLI에 전달합니다. 직접 연결한 수집기가 하는 외부 호출은 해당 수집기의 동작에 따릅니다.

데이터 폴더는 저장소 밖에 두어야 합니다. 생성 파일은 소유자만 읽고 쓸 수 있게 저장합니다. 데스크톱 알림에는 작업 제목이 나타나므로 잠금 화면 표시 여부는 운영체제 알림 설정에서 조절하세요. 제거 시 데이터 폴더도 직접 삭제하면 백엔드 기록이 사라집니다. Orca에 저장된 대화와 워크트리는 별도입니다.

세션 복원은 Orca 1.4.248의 로컬 `agentSession.reveal` RPC를 사용합니다. 인증 정보는 런타임의 소유자 전용 파일에서 읽어 로컬 Unix 소켓에만 전달하며 저장하거나 출력하지 않습니다. 런타임 메타데이터 위치가 다르면 백엔드 설정의 `runtimeMetadataPath`에 절대 경로를 지정합니다. 향후 Orca API 변경으로 복원이 실패하면 새 대화로 대체하지 않고 오류를 표시합니다.

## 복구와 개발

실행 응답이 유실되면 `실행 불확실`로 남겨 자동 재시도를 막습니다. Orca에서 실제 워크트리와 채팅 생성 여부를 확인한 뒤 데이터 폴더의 `panel-actions/<id>.json`을 백업하고 정리하세요. 수집기를 강제 종료했다면 `manual-collection.json`의 PID가 종료됐는지 확인한 다음 `manual-collection.lock`을 제거합니다. 잠금을 실행 중에 지우면 중복 실행할 수 있습니다.

개발에는 Orca CLI가 필요합니다.

```sh
npm ci
orca plugin types . --json
npm run typecheck
npm run build
npm test
npm run test:package
```

TypeScript와 TSX는 Orca가 직접 읽습니다. 배포용 `vendor/`에는 날짜 계산과 입력 검증 의존성을 라이선스와 함께 묶습니다. `npm run build:vendor`로 재생성합니다. `src/panel.check.ts`의 합성 데이터로 정상·실패·빈 상태·저장된 세션을 검사합니다.

GitHub Actions는 macOS/Linux에서 배포 의존성 재생성과 CLI 설치·데모 동작을 확인합니다. Orca 전용 패널·워커 테스트는 위 명령으로 별도 실행합니다.

MIT License. 포함된 의존성의 라이선스는 `vendor/`에 있습니다.

## GitHub 수집기 참고

- [GitHub REST: 본인 계정 알림 조회와 지원 인증](https://docs.github.com/en/rest/activity/notifications#list-notifications-for-the-authenticated-user)
- [GitHub CLI: API 조회와 페이지 처리](https://cli.github.com/manual/gh_api)
