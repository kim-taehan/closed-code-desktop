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

4. **`/api/*` 응답은 `{ data: ... }` 로 감싸여 온다.** 레거시 경로는 안 감싼다.
   모르면 세션 id 가 undefined 로 새고, 증상은 한참 뒤 "핸드셰이크는 ready 인데 무응답" 으로만 나온다.

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
| 상태 | ✅ 동작 | ⬜ 프레임이 조용히 버려진다 (`opencode/transport.ts:129`) |

**둘은 아무 관계가 없다.** 채널·타입·설정 문구를 갈라 뒀고, 새 파일 머리주석마다 이 구분을 적는다.

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

모델은 `~/.config/opencode/opencode.json` 의 `davis-litellm` 프로바이더를 쓴다
(사내 LiteLLM `http://<internal-llm-ip>/v1` — `glm-5.2` / `qwen3.6-35b`).

### 실서버 검증

```bash
OPENCODE_LIVE=1 npx vitest run electron/opencode/live.test.ts
```

기본 실행에서는 건너뛴다(서버·모델 필요). **가짜 서버로는 안 잡히는 계약 어긋남을 잡는 유일한 그물**이며,
위 함정 목록 중 4건이 여기서 나왔다 — 넷 다 타입체크·단위테스트는 초록이었다.

> ⚠️ 라이브 검증에 **이 레포 루트를 워크스페이스로 주지 말 것.** `node_modules` 가 700MB 가까워
> opencode 초기 스캔에서 멈추고, 증상이 "어댑터가 이벤트를 못 받는다" 로 보인다.

### 모델 선택 주의

`qwen3.6-35b` 는 약한 모델이다. davis 런타임은 이걸 굴리려고 방어 미들웨어를 두껍게 쌓았고
(`davis-code/runtime-weak-model-workarounds.md` — 시스템 프롬프트 9K자부터 환각, `edit_file` 34회 반복 등),
**opencode 에는 그 층이 없다.** 어댑터 검증은 `glm-5.2` 로 하고, 약한 모델 내구성은 별도로 판정할 것 —
두 변수를 같이 흔들면 실패 원인을 못 가린다.

## 착지 기준

- **파일당 300줄 상한** (`.ts`/`.tsx`, `scripts/check-file-size.mjs`). 초과는 추출로 푼다
- **완료 = 게이트 3종 동시 초록** (typecheck 2 tsconfig · lint:filesize · vitest)

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
