# Open Code Desktop

[opencode](https://opencode.ai) 헤드리스 서버에 붙는 Electron 데스크톱 클라이언트.

`davis-code-desktop` 의 소스를 복사해 출발했다. UI·IPC·프로세스 수명관리·세션 계층은 그대로 쓰고,
**런타임과 말하는 계층만 davis WebSocket → opencode HTTP+SSE 로 갈아끼운다.**

## 현재 상태

| 계층 | 상태 |
|---|---|
| 렌더러 (React 19) · IPC · git 패널 · 설정 | 그대로 동작 (복사본) |
| **`electron/opencode/` 어댑터** | ✅ 핸드셰이크·텍스트·추론·도구·턴 종료·취소·승인·질문 |
| **앱 배선** (`sessionWiring` → `OpencodeConnection`) | ✅ **앱이 opencode 로 붙는다.** davis WS 경로는 안 쓴다 |
| **가짜 opencode 서버** (`tests/fake-opencode/`) | ✅ 세션 격리·생사 신호 테스트가 이걸로 돈다 |
| **`electron/mcp/` 데스크톱 MCP 서버** | ✅ 앱이 **MCP 서버**가 되어 프로젝트가 붙을 때마다 opencode 에 자동 등록된다 (`AppSettings.desktopMcp`) |
| **`electron/pty/` 셸 드로어 (⌘↓/⌘↑)** | ✅ opencode 의 `/api/pty` 에 붙는다. **네이티브 모듈 없음** |
| `electron/runtime/` 프로세스 수명관리 | ⬜ 미전환 — 서버는 사용자가 직접 띄운다 |
| 채팅 이력 · 턴 리뷰(diff) · 모델 스위처 | ⬜ 미착수 — 프레임은 나가지만 opencode 대응이 없어 조용히 버려진다 |
| MCP **클라이언트** 설정 (`McpDialog`·`session/mcpConfig.ts`) | ⬜ 미착수 — 위의 `electron/mcp/` 와 **다른 것이다** (아래 「두 가지 MCP」) |
| 확장 질의 레인 (`agentLane`) | ⬜ 미전환 — 아직 davis WS 소켓을 연다 |

어댑터는 **실제 opencode 서버로 한 턴을 끝까지 돌려 검증**했다 (`electron/opencode/live.test.ts`).

### 서버는 우리가 띄우지 않는다

davis 시절엔 앱이 런타임을 내려받아 띄우고 포트 8000~8099 를 훑어 찾았다. opencode 는
**사용자가 띄운 한 곳에 붙을 뿐**이다 (`opencodeUrl`, 기본 `http://127.0.0.1:4096`).
서버가 없으면 `connect()` 가 거부하고 그 이유가 그대로 화면에 뜬다.

```bash
opencode serve --port 4096 --hostname 127.0.0.1   # 먼저 띄운다
npm run dev
```

## 접근 — 부패방지 계층(anti-corruption layer)

```
session/*  ──davis 봉투(kind/action)──▶  OpencodeTransport  ──HTTP+SSE──▶  opencode serve
             (한 줄도 안 고친다)             (양방향 번역만)                  (:4096)
```

`electron/ws/transport.ts` 의 `Transport` 인터페이스가 갈아끼우는 자리다. 세션 계층 전체가
이 인터페이스만 알기 때문에(설계 §10 DIP), 어댑터 하나로 `chunkRoutes` 매핑표·버블 묶기·
승인 카드·턴 게이트가 전부 산다.

| 파일 | 역할 |
|---|---|
| `electron/opencode/events.ts` | opencode 이벤트 타입 + SSE 한 줄 파싱 |
| `electron/opencode/translate.ts` | **이벤트 → davis 봉투.** 매핑의 정본 |
| `electron/opencode/client.ts` | HTTP 호출 (세션·프롬프트·중단·승인·질문) |
| `electron/opencode/sse.ts` | `/api/event` SSE 리더 (재연결 포함) |
| `electron/opencode/transport.ts` | `Transport` 구현. 위 넷을 묶고 없는 개념을 합성 |
| `electron/opencode/connection.ts` | 연결 수명(붙기·버리기·재연결·상태). `WsConnection` 과 같은 자리 |
| `electron/opencode/endpoint.ts` | 서버 주소 해석 (탐색 없음) |

세션 계층이 요구하는 수명 API 는 `electron/ws/transport.ts` 의 **`SessionConnection`** 인터페이스로
뽑아 뒀다. `WsConnection`(davis) 과 `OpencodeConnection` 이 둘 다 이걸 만족하므로 배선 코드가 같다.

### 매핑 (실측 기준, opencode 1.17.18)

| davis | opencode |
|---|---|
| `system/connected` | `server.connected` |
| `auth_state {valid}` | **합성** — opencode 에 라이선스 개념이 없다 |
| `workspace_state {ready}` | `POST /api/session` 성공 (directory = 워크스페이스) |
| `turn_start` | `session.next.step.started` |
| `text` | `session.next.text.delta` |
| `thinking` | `session.next.reasoning.delta` |
| `tool_call` | `session.next.tool.input.started` (이 시점에 이미 이름을 안다) |
| `tool_result` | `session.next.tool.success` / `.failed` |
| `turn_end` + `stream_end` | `session.next.step.ended` 중 `finish !== 'tool-calls'` |
| `error` | `session.error` |
| `tool_approval_request` → 응답 | `permission.v2.asked` → `POST …/permission/{id}/reply` |
| `user_question` → 응답 | `question.v2.asked` → `POST …/question/{id}/reply` |
| `stream_cancel` | `POST …/interrupt` |

## ⚠️ opencode 실측 함정 (공식 문서와 다르다)

전부 직접 부딪혀 확인한 것이다. **문서를 믿고 짜면 전부 밟는다.**

1. **API 가 두 벌이고 이벤트 계열이 통째로 다르다**
   - `POST /session/:id/message` (레거시) → `message.part.*`
   - `POST /api/session/:id/prompt` (신규) → `session.next.*`
   - 섞으면 핸드셰이크는 통과하는데 **채팅 청크가 0건**이다.

2. **SSE 도 두 벌이다.** 같은 시각 동시에 떠서 비교한 결과:
   - `/api/event` → `session.next.*` 전부 (238줄)
   - `/event` → `server.connected` + heartbeat 뿐 (10줄)

3. **페이로드 필드 이름이 스트림마다 다르다.** `/api/event` 는 `data`, 레거시 `/event` 는 `properties`.
   안 맞추면 파싱은 되는데 필드가 전부 undefined 가 되어 **내용 없는 청크**가 흐른다.

4. **`/api/*` 응답은 대개 `{ data: ... }` 로 감싸여 온다 — 전부는 아니다.** 레거시 경로는 안 감싼다.
   안 벗기면 세션 id 가 undefined 로 새고, 증상은 한참 뒤 "핸드셰이크는 ready 인데 무응답" 으로만
   나온다. **이 실패는 여전히 참이다.** 틀렸던 것은 "`/api/*` 전부" 라는 **범위**뿐이다 —
   근거는 세션·이벤트 계열에서만 나왔는데 문장이 전체를 단정했다.

   1.17.18 에서 인자 없는 `/api/*` GET 16개를 전수로 재 봤다 (SSE 인 `/api/event` 와 인자가
   필요한 `fs/find`·`fs/read/*` 는 뺐다). **봉투가 한 모양이 아니다** —
   `.data` 만 벗기면 되는 것과 형제 필드가 붙는 것이 갈린다:

   | 봉투 | 수 | 경로 |
   |---|---:|---|
   | `{location, data}` | 11 | `agent` · `command` · `fs/list` · `integration` · `model` · `permission/request` · `provider` · `pty` · `question/request` · `reference` · `skill` |
   | `{data}` 단독 | 2 | `permission/saved` · `session/active` |
   | `{data, cursor}` | 1 | `session` (GET) |
   | **안 감싼다** | **2** | **`/api/health` → `{"healthy":true}`** · `/api/location` → `{"directory","project"}` |

   POST 도 쟀다 — `POST /api/session` · `POST /api/session/{id}/prompt` 는 **`{data}` 단독**이다
   (`location` 이 없다). 원래 근거인 `{data:{id:"ses_…"}}` 가 그것이다.
   **안 재 본 것:** 인자가 들어가는 GET 과 `PUT`/`DELETE`.
   `/api/health` 에서 `.data` 를 벗기려 들면 막힌다.
   **다만 진단은 `/api/health` 를 안 쓴다** — `electron/opencode/probe.ts` 의 `pingOpencode` 는
   `/global/health` 를 부른다. 옮긴 이유가 **둘**이다: ① `/global/health` 만
   `{"healthy":true,"version":"1.17.18"}` 처럼 **릴리스 버전을 준다** (그 값으로
   하한선 `shared/opencode/version.ts` 를 대조한다) · ② **`/api/health` 라우트가 옛 판에는 없다** —
   1.14.28 에서 그 주소는 웹 UI HTML 을 돌려주므로(아래 함정 11) 그 서버를
   **"안 떠 있습니다" 로 오진**했다. `/global/health` 는 1.14.28 에도 있고 버전도 준다.
   **잰 점은 1.14.28 · 1.17.17 · 1.17.18 · 1.18.16 넷이고 그 사이는 안 쟀다.**
   `/global/health` 도 안 감싼다.

5. **경로 이름이 문서와 다르다.** `abort` → `interrupt`, `permissions/:id` → `permission/:id/reply`.

6. **`session.idle` 에 기대지 말 것.** `/api` 경로에서는 오지 않는다. 턴 종료는
   `session.next.step.ended` 의 `finish` 로 판정한다 (`tool-calls` 면 아직 안 끝났다).

7. **`textID` 는 메시지 안에서만 유일하다** (`text-0` 이 매번 재사용됨).
   버블 묶기 키는 `assistantMessageID:textID` 여야 한다.

8. **`POST /mcp` 는 `/api` 판이 없다.** 1번("두 API 세대를 섞지 말 것")과 겉으로 충돌해 보이지만
   `/api/mcp` 가 아예 존재하지 않는다 (162경로 전수 확인) — 선택지가 없다. 레거시 표면이라
   `{data:...}` 래핑도 없다. `electron/opencode/client.ts` 의 `addMcpServer` 한 곳뿐이다.

9. **비밀번호 인증은 Bearer 가 아니라 HTTP Basic 이고 사용자명이 `opencode` 로 고정이다.**
   `OPENCODE_SERVER_PASSWORD` 를 건 서버에 네 가지를 다 넣어 봤고 통과한 것은 하나뿐이다:
   `Bearer <pw>` → 401, `x-opencode-password` → 401, `Basic <"":pw>` → 401,
   **`Basic <"opencode":pw>` → 200**. HTTP 와 WebSocket 이 같은 헤더를 쓴다.
   `POST /api/pty/{id}/connect-token` 은 비밀번호를 걸든 안 걸든 403 을 주므로 쓰지 않는다.

10. **pty 는 서버가 굴린다 — 그리고 인자를 스스로 붙인다.** `POST /api/pty` 에 `args:["-l"]`
    을 주면 `["-l","-l"]` 이 된다. **`args` 를 보내지 않는다.** 크기 변경은 WS 가 아니라
    `PUT /api/pty/{id}` 의 `{size:{rows,cols}}` 이고, 셸 종료는 제어 프레임이 아니라
    **WS close(1000)** 으로 온다 (종료 코드는 `GET /api/pty/{id}` 의 `exitCode`).

11. **없는 경로가 404 를 주지 않는다 — 200 에 웹 UI HTML 을 준다.** SPA 폴백이 걸린다.
    실측: `/api/config` · `/api/config/providers` (1.17.18) · `/api/health` (1.14.28, 그 판엔
    라우트가 없다). **`response.ok` 가 참이라 코드가 그대로 진행하고 JSON 파싱에서야 터진다** —
    화면에는 "경로가 틀렸다" 가 아니라 파싱 오류나 "서버가 안 떠 있습니다" 로 뜬다.
    **상태 코드로는 못 가리므로 URL 자체를 단언하는 것 말고 그물이 없다**
    (`electron/opencode/probe.test.ts`·`probeModels.test.ts` 가 그걸 한다).

    같은 이유로 **"경로가 없으면 404" 를 전제한 주석 둘이 틀려 있었다.** 1.17.18 은
    이중 슬래시(`//api/health`·`//global/health`·`//config/providers`)도 **전부 200** 이다.
    주소 끝의 `/` 를 떼는 것은 여전히 하되, 근거는 404 회피가 아니라 **주소를 한 모양으로
    모으는 것**이다 (프록시가 앞에 붙었을 때는 안 재 봤다).

> 버전을 올리면 `curl http://127.0.0.1:4096/doc` 을 다시 떠서 대조할 것.

## davis 대응이 없는 신규 표면

아래 둘은 **매핑표에 줄이 없다.** davis 런타임에 대응 개념이 아예 없고, opencode 서버가
이미 갖고 있어서 그대로 쓴다 — 번역이 아니라 새로 붙인 계층이다.

| 표면 | 우리 쪽 | 무엇을 안 하게 됐나 |
|---|---|---|
| `/api/pty` (셸) | `electron/pty/` | **`node-pty` 를 안 들인다.** `electron-rebuild`·arm64/x64 재빌드·`asarUnpack` 이 통째로 없다. 새 의존은 `@xterm/xterm`·`@xterm/addon-fit` (둘 다 순수 JS) |
| `POST /mcp` (MCP 등록) | `electron/mcp/` | **사용자 `~/.config/opencode/opencode.json` 을 안 고친다.** 등록이 instance 수명이라 앱을 끄면 죽은 항목이 남지 않는다 — 대신 **재연결마다 다시 등록**한다 |

### 두 가지 MCP — 같은 낱말, 다른 뜻

| | 앱이 MCP **서버** | 앱이 MCP **클라이언트** |
|---|---|---|
| 자리 | `electron/mcp/`, `Channel.DESKTOP_MCP_*` | `electron/session/mcpConfig.ts`, `src/components/McpDialog.tsx`, `Channel.MCP_*` |
| 하는 일 | 에이전트가 우리 앱을 조작한다 (`open_file`·`current_view`) | 사용자가 남의 MCP 서버에 쓸 개인 자격을 넣는다 |
| 상태 | ⚠️ **등록까지 동작** (아래) | ⬜ 프레임이 조용히 버려진다 (`opencode/transport.ts:129`) |

**둘은 아무 관계가 없다.** 채널·타입·설정 문구를 갈라 뒀고, 새 파일 머리주석마다 이 구분을 적는다.

#### ⚠️ 「앱이 MCP 서버」 는 **등록까지**만 착지했다 (실측 2026-08-12)

| 겹 | 무엇 | 결과 |
|---|---|---|
| 1 | `POST /mcp?directory=` → `connected` | ✅ |
| 2 | opencode 가 `tools/list` 로 우리 도구를 받아 감 | ✅ |
| 3 | **그 도구가 모델에게 나가는 도구 집합에 들어감** | ❌ |
| 4·5 | 모델이 호출 → 우리 서버에 도달 | 3 때문에 도달 못 함 |

모델에게 가는 `/v1/chat/completions` 를 프록시로 가로채 봤고, opencode 자신의 오라클
(`GET /experimental/tool?provider=&model=`)도 같은 답을 줬다 — **둘 다 내장 도구 12개뿐**이다.

**우리 응답 모양의 문제가 아니다.** 참조 MCP 서버(표준 응답의 stdio 서버)를 대조군으로
나란히 세웠는데 **그것도 안 실린다.** 등록 경로 셋(런타임 `POST /mcp` · 프로젝트 설정의
remote · 같은 설정의 local stdio)이 전부 같고, `config.tools` 로 이름을 명시 허용해도
안 바뀐다. **opencode 1.17.18 과 1.18.16 둘 다 그렇다.**

**어디서 끊기는지는 모른다.** 설치본은 난독화돼 있고 포크 소스는 버전이 달라, 합치는 코드가
있다는 것까지만 읽힌다. **"opencode 버그" 라고 단정하지 않는다** — 우리가 모르는 설정
조건일 수도 있다. 재현 절차·대조군·두 버전 결과는 `_workspace/03_contract_qa.md` 의
**12·13회차**에 있다.

`AppSettings.desktopMcp` 는 **켜짐이 기본이다**(사용자 결정). 지금은 켜도 포트만 열리지만,
opencode 쪽이 풀리면 **우리 코드 변경 없이 바로 동작한다.**

## 개발

```bash
npm install
npm run dev          # Electron + Vite
npm test             # vitest
npm run typecheck    # tsconfig 2개
npm run lint:filesize
```

### opencode 서버

```bash
opencode serve --port 4096 --hostname 127.0.0.1
```

모델은 `~/.config/opencode/opencode.json` 의 **`ollama-local` 프로바이더**를 쓴다
(로컬 ollama `http://127.0.0.1:11434/v1` — `devstral:24b`, `"model": "ollama-local/devstral:24b"`).

### 실서버 검증

```bash
ollama serve                                        # 모델도 함께 떠 있어야 한다
opencode serve --port 4096 --hostname 127.0.0.1
OPENCODE_LIVE=1 npx vitest run electron/opencode/live.test.ts
```

**서버가 둘이다.** opencode 만 띄우면 핸드셰이크까지는 가고 **턴이 답을 못 받는다** —
모델은 opencode 뒤의 프로바이더(여기서는 로컬 ollama)가 굴린다. `ollama` 가 안 떠 있으면
`http://127.0.0.1:11434` 가 거절하고, 증상은 "어댑터가 응답을 못 받는다" 로만 보인다.

기본 실행에서는 건너뛴다(서버·모델 필요). **가짜 서버로는 안 잡히는 계약 어긋남을 잡는 유일한 그물**이며,
위 함정 목록 중 4건이 여기서 나왔다 — 넷 다 타입체크·단위테스트는 초록이었다.

> ⚠️ 라이브 검증에 **이 레포 루트를 워크스페이스로 주지 말 것.** `node_modules` 가 700MB 가까워
> opencode 초기 스캔에서 멈추고, 증상이 "어댑터가 이벤트를 못 받는다" 로 보인다.

### 모델 선택 주의

**약한 모델을 어댑터 검증과 같이 흔들지 않는다.** davis 런타임은 약한 모델을 굴리려고 방어
미들웨어를 두껍게 쌓았고 (`davis-code/runtime-weak-model-workarounds.md` — 시스템 프롬프트
9K자부터 환각, `edit_file` 34회 반복 등), **opencode 에는 그 층이 없다.** 어댑터가 이상해 보일 때
그것이 어댑터 탓인지 모델 탓인지 가르려면 한 번에 하나만 바꿔야 한다.

지금 기본값 `devstral:24b` 는 `tool_call: true` 로 선언돼 있고 **도구를 실제로 부른다**
(`/api/chat`·`/v1/chat/completions` 양쪽 확인). 다만 **프롬프트가 약하면 안 부른다** —
system 없이 캐주얼하게 물으면 도구 대신 "확인 중입니다…" 로 답하고, system 에 "도구를 반드시
쓰라"를 넣으면 부른다. **opencode 는 자기 system 프롬프트를 싣기 때문에 실제 경로는 이 실험과
다를 수 있다.**

> **예전 구성** — `davis-litellm`(사내 LiteLLM `http://<internal-llm-ip>/v1`)의 `glm-5.2`(검증용)와
> `qwen3.6-35b`(약한 모델 판정용). **설정에서 사라졌고 그 주소는 이 환경에서 응답이 없다.**
> 위 원칙은 저 구성에서 나왔지만 모델이 바뀌어도 그대로 유효하다 — 낡은 것은 이름뿐이다.

## 착지 기준

- **파일당 300줄 상한** (`.ts`/`.tsx`, `scripts/check-file-size.mjs`). 초과는 추출로 푼다
- **완료 = 게이트 4종 동시 초록** — 자산 매니페스트
  (`shasum -c src/lib/davis-progress/.davis-progress-sync.sha256`) · `lint:filesize` ·
  typecheck(2 tsconfig) · vitest. **매니페스트가 빠져 있었다** — CI 는 처음부터 넷을 돌린다

## 테스트 척추

| 층 | 도구 | 무엇을 잡나 |
|---|---|---|
| 번역 | `translate.test.ts` | 실측 페이로드 → davis 청크 매핑 |
| 어댑터 | `transport.test.ts` | 진짜 `Handshake` 가 4단계를 통과하는가 (가짜 fetch) |
| 세션 | `tests/fake-opencode/` | 프로젝트 격리·연결 생사 (가짜 HTTP+SSE 서버) |
| 실물 | `live.test.ts` | 계약 어긋남 (실서버, 기본 skip) |

> 가짜 서버는 **실물 계약을 그대로** 흉내낸다 — `{data:...}` 래핑, 이벤트 페이로드 필드 `data`,
> `/api/event` 가 서버 전역인 점까지. 실물과 어긋난 가짜는 초록을 주면서 버그를 통과시킨다.
> 특히 **세션 격리는 opencode 에서 davis 때보다 위험하다**: 서버 하나에 세션이 여럿이고
> 이벤트 스트림이 전역이라, 남의 턴이 내 스트림으로 들어온다. 격리는 어댑터의 sessionID 필터뿐이다.

## 남은 davis 흔적

- `PROJECT_STRUCTURE.md` · `docs/superpowers/specs/` — davis 시절 설계 이력 (참고용)
- `docs/reference/vscode-behavior/` — **의도적으로 남김.** `chunkRoutes.ts` 등 코드 주석이 근거로 인용한다
- `shared/protocol/*` 의 주석에 남은 davis 런타임 실측 근거 — 사실이 아니게 되면 지우지 말고 **고쳐 쓴다**
- 확장 스크립트 (`ext:pack`·`ext:registry`) — 쓸지 미정
