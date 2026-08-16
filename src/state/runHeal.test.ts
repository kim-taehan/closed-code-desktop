import { describe, expect, it } from 'vitest'
import { fixLine, prescribe, runHealNotice, type Prescription } from './runHeal'

// **처방이 무엇을 알아보고 무엇을 안 알아보나.** 이 시험의 절반은 *안 걸리는 것*을 잠근다 —
// 틀린 처방은 안 도는 것보다 나쁘다: 사용자 프로젝트에 설치를 돌려 놓고 증상은 그대로다
// (설계 2026-08-16 §4 「처방은 실측으로만 늘린다」).

// 아래 문장들은 **실측 원문**이다 (Node v22.18.0, 임시 폴더에 `npm run dev`, 2026-08-16).
// 지어낸 문장으로 잠그면 매칭이 초록인 채로 실물을 못 알아본다.

/** 의존성이 없다 — CJS 로더 */
const MISSING = "Error: Cannot find module 'vite'\n    at Module._resolveFilename"
/** 의존성이 없다 — ESM 로더. **낱말이 `package` 로 갈린다** */
const MISSING_ESM =
  "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vite' imported from /tmp/probe/index.mjs"

describe('처방 — 아는 실패', () => {
  it("`Cannot find module 'x'` 를 의존성 설치로 읽는다", () => {
    expect(prescribe(MISSING, 'npm run dev')).toEqual({
      id: 'missing-module',
      missing: 'vite',
      fix: 'npm install',
    })
  })

  // 설치기는 **명령의 첫 낱말**에서만 온다. 락파일을 뒤지지 않는다 (설계 §2)
  it.each([
    ['pnpm dev', 'pnpm install'],
    ['yarn start', 'yarn install'],
    ['bun run dev', 'bun install'],
  ])('%s → %s', (command, fix) => {
    expect(prescribe(MISSING, command)?.fix).toBe(fix)
  })

  // ⭐ **ESM 은 낱말이 `package` 다.** 이 줄이 없으면 요즘 프로젝트 대부분
  // (`"type": "module"`)에서 오토힐링이 통째로 안 돈다 — 실측하고서야 알았다.
  it('ESM 의 다른 낱말도 같은 처방으로 읽는다', () => {
    expect(prescribe(MISSING_ESM, 'npm run dev')).toEqual({
      id: 'missing-module',
      missing: 'vite',
      fix: 'npm install',
    })
  })

  // 색이 섞여 들어온다 — 버퍼가 ANSI 를 일부러 안 벗기기 때문이다 (`outputBuffer.ts`)
  it('색이 섞여 있어도 알아본다', () => {
    const colored = "\u001b[31mError: Cannot find module 'vite'\u001b[0m"
    expect(prescribe(colored, 'npm run dev')?.missing).toBe('vite')
  })
})

describe('처방 — 안 걸려야 하는 것', () => {
  // ⭐ 설치로 안 고쳐지는 실패다. 걸리면 `npm install` 이 멀쩡히 성공한 뒤 같은 실패가
  // 그대로 다시 나고, 사용자는 우리가 왜 아무 소용 없는 짓을 했는지 모른다.
  //
  // **절대경로 갈래는 실측이다** — ESM 에서 `./nope.js` 를 못 찾으면 낱말은 `module` 인 채
  // 따옴표 안이 통째로 절대경로가 된다. 지어낸 걱정이 아니라 실제로 오는 모양이다.
  it.each([
    "Cannot find module './missing'",
    "Cannot find module '../lib/x'",
    "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/tmp/probe/nope.js' imported from /tmp/probe/index.mjs",
  ])('경로를 못 찾은 것에는 처방이 없다: %s', (output) => {
    expect(prescribe(output, 'npm run dev')).toBeNull()
  })

  // 모르면 아무것도 안 한다 — `make dev` 가 속으로 npm 을 쓰더라도 우리는 모른다
  it('모르는 실행기는 처방이 없다', () => {
    expect(prescribe(MISSING, 'make dev')).toBeNull()
    expect(prescribe(MISSING, './gradlew bootRun')).toBeNull()
  })

  // ⭐ **아직 못 잰 이웃들.** 실측하는 날 여기가 초록에서 빨강으로 바뀌고, 그게 신호다.
  // (ESM 은 여기 있었다 — 재 보니 실제로 오는 모양이라 위쪽 「아는 실패」로 옮겼다.)
  it.each([
    "ModuleNotFoundError: No module named 'flask'",
    'Could not resolve dependency: com.example:lib:1.0',
  ])('아직 안 재 본 변종은 조용하다: %s', (output) => {
    expect(prescribe(output, 'npm run dev')).toBeNull()
  })

  it('평범한 줄에는 아무 일도 없다', () => {
    expect(prescribe('VITE v5.0.0  ready in 300 ms', 'npm run dev')).toBeNull()
  })
})

const RX: Prescription = { id: 'missing-module', missing: 'vite', fix: 'npm install' }

describe('무엇을 돌리나', () => {
  // `;` 가 아니라 `&&` — 설치가 깨졌는데 원래 명령을 또 돌리면 같은 실패가 한 벌 더 쌓인다
  it('설치가 성공해야 다시 띄운다', () => {
    expect(fixLine(RX, 'npm run dev')).toBe('npm install && npm run dev')
  })
})

describe('문구 — 예고가 축이다', () => {
  const notice = (phase: 'announce' | 'healing' | 'stuck') =>
    runHealNotice('dev 서버', 'npm run dev', RX, phase, 5_000)

  // ⭐ **아직 안 한 일을 말한다.** 조치가 일어난 뒤에 알리면 사용자는 통보만 받고 멈출
  // 기회를 못 가진다 (Doctor 설계 §3). 몇 초 뒤인지가 곧 물릴 수 있는 시간이다.
  it('예고는 앞으로 할 일과 남은 시간을 말한다', () => {
    const it$ = notice('announce')
    expect(it$.headline).toContain('5초 뒤')
    expect(it$.headline).toContain('npm install')
    expect(it$.headline).toContain('다시 띄웁니다')
    // 아직 아무것도 안 돈다 — 도는 표시를 내면 이미 한 것처럼 보인다
    expect(it$.spinning).toBe(false)
    expect(it$.dismissLabel).toBe('지금은 그만')
  })

  it('진행은 실제로 돌린 한 줄을 그대로 보여 준다', () => {
    const it$ = notice('healing')
    expect(it$.headline).toContain('npm install && npm run dev')
    expect(it$.spinning).toBe(true)
    // 이미 나간 명령이라 「지금은 그만」이 아니다 — 그렇게 적으면 취소로 읽힌다
    expect(it$.dismissLabel).toBe('닫기')
  })

  // 못 고치면 **멈추고 설명한다** (설계 §4). 다음에 할 일이 사람에게 넘어간 것을 말한다
  it('막히면 한 바퀴가 상한이라는 사실을 말한다', () => {
    const it$ = notice('stuck')
    expect(it$.headline).toContain('못 고쳤습니다')
    expect(it$.detail).toContain('한 바퀴만')
    expect(it$.spinning).toBe(false)
  })

  // 근거는 지어내지 않고 로그에서 뽑은 것을 쓴다
  it('근거에 못 찾은 모듈 이름이 들어간다', () => {
    for (const phase of ['announce', 'healing', 'stuck'] as const) {
      expect(notice(phase).detail).toContain('vite')
    }
  })
})
