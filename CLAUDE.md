# CLAUDE.md — open-code-desktop

opencode 헤드리스 서버(HTTP+SSE)에 붙는 Electron 데스크톱 클라이언트.
프로젝트 개요·현재 상태·이벤트 매핑표는 `README.md`.

`davis-code-desktop` 소스를 복사해 출발했다. **이 레포는 davis 제품 라인이 아니다** —
메타레포(`../davis-code`)의 크로스레포 하네스·Jira 커밋 규칙 대상이 아니고, 독립적으로 굴린다.

## 이 레포의 착지 기준

- **파일당 300줄 상한** (`.ts`/`.tsx`, `scripts/check-file-size.mjs`). 초과는 추출로 푼다.
  주석 삭제로 줄이지 않는다 — 이 레포의 주석은 실측 근거다 (davis 시절부터 이어진 규칙)
- **완료 = 게이트 4종 동시 초록** — 자산 매니페스트
  (`shasum -c src/lib/davis-progress/.davis-progress-sync.sha256`) · `lint:filesize` ·
  typecheck(2 tsconfig) · vitest. **매니페스트가 빠져 있었다** — CI 는 처음부터 넷을 돌린다
- 커밋·푸시는 사용자가 요청할 때만

## 작업할 때 알아야 할 것

**갈아끼우는 자리는 `electron/ws/transport.ts` 의 `Transport`/`SessionConnection` 인터페이스다.**
`electron/session/*` 전체가 이 인터페이스만 알고 ws 라이브러리를 직접 쓰지 않는다 (설계 §10 DIP).
opencode 어댑터(`electron/opencode/`)는 davis 봉투(`kind`/`action`)를 흉내내 위층에 먹이는
**부패방지 계층**이다 — 위층을 고치는 게 아니라 번역한다. 새 기능을 붙일 때도 이 원칙을 지킨다:
`session/*` 를 고쳐야 할 것 같으면, 먼저 어댑터에서 번역으로 풀 수 있는지 본다.

**세션 격리를 깨뜨리지 말 것.** `/api/event` 는 **서버 전역**이라 다른 프로젝트 세션의 이벤트가
같은 스트림으로 들어온다. 막는 것은 `transport.ts` 의 sessionID 필터 하나뿐이고,
`electron/session/multiSession.test.ts` 가 그걸 겨눈다. davis 때는 프로젝트마다 소켓이 갈려
물리적으로 안전했던 자리다 — 그 감각으로 만지면 남의 대화가 화면에 샌다.

**프로토콜 정본은 opencode 의 OpenAPI 다.** 추측하지 말고 뜬다:

```bash
opencode serve --port 4096 --hostname 127.0.0.1
curl http://127.0.0.1:4096/doc
```

**`shared/protocol/*` 와 `electron/session/*` 의 주석은 davis 런타임 소스를 실측한 근거다.**
opencode 로 옮기며 사실이 아니게 된 주석은 지우지 말고 **고쳐 쓴다** — 어디가 왜 달라졌는지가
어댑터의 설계 근거가 된다.

## 모델

`~/.config/opencode/opencode.json` 에 **프로바이더가 둘 다 있고, 기본값은 사내 쪽이다**
(2026-08-13 실측 — 아래 「예전 구성」이 주장하던 것과 다르다).

| 프로바이더 | 모델 | 지금 상태 |
|---|---|---|
| `davis-litellm` (사내 `http://<internal-llm-ip>/v1`) | `glm-5.2` · `qwen3.6-35b` | **기본값**(`"model": "davis-litellm/glm-5.2"`). 살아 있다 — 인증 없이 `/v1/models` 는 401, 키를 실으면 `chat/completions` 가 **0.4초에 200** |
| `ollama-local` (로컬 `http://127.0.0.1:11434/v1`) | `devstral:24b` (**`tool_call: true`**) | 설정에는 있으나 **지금 안 떠 있다** (HTTP 000) |

**도구를 실제로 부른다** — `/api/chat`(네이티브)과 `/v1/chat/completions`(opencode 가 쓰는 길)
양쪽에서 확인됐다. 단, **프롬프트가 약하면 안 부른다**: system 메시지 없이 캐주얼하게 물으면
도구 대신 "확인 중입니다…" 로 답하고, system 에 "도구를 반드시 쓰라"를 넣으면 부른다.
**opencode 는 자기 system 프롬프트를 실으므로 실제 경로는 이 실험과 다를 수 있다.**

두 변수(엔진 교체 · 모델 교체)를 동시에 흔들지 않는다. 실패 원인을 못 가린다.

### 이 절이 한 번 틀렸다 — "사내 구성은 없어졌다"

여기에는 `davis-litellm` 이 **설정에서 사라졌고 주소도 HTTP 000 으로 죽었다**고 적혀 있었다.
2026-08-13 에 재 보니 **둘 다 사실이 아니다** — 설정에 있고, 기본 모델이고, 응답한다(위 표).

이 오기의 값은 문장 하나가 아니었다: 그 기록을 믿고 **"LLM 이 없으니 못 잰다"** 로 판단해
계약 측정을 미뤘고, 사용자가 "지금 사내 LLM 으로 테스트하면 되는데?" 라고 짚어서야 돌아왔다.
**"지금은 없다" 류의 단정은 잰 날짜와 함께 적고, 쓰기 전에 다시 재라.**

`glm-5.2` 는 어댑터 검증용, `qwen3.6-35b` 는 약한 모델 내구성 판정용이라는 구분은 그대로다.
위 "두 변수(엔진·모델)를 동시에 흔들지 않는다" 원칙도 그대로 유효하다.
