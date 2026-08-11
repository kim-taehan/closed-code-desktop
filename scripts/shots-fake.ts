// 가짜 런타임으로 SP#23 화면 캡처 (vite-node 로 실행).
//
//   npm run build && npx vite-node scripts/shots-fake.ts
//   npx vite-node scripts/shots-fake.ts -- --only=thinking
//
// **왜 가짜 런타임인가** — 추론 블록과 작업 경로 바는 runtime 이 밀어줘야 화면에 뜬다.
// 그런데 운영 Qwen 은 VL 변형이라 vLLM reasoning_parser 가 없어 thinking 을 못 만든다
// (runtime model_profiles.py: supports_thinking 미부여). 실제 LLM 으로는 영영 못 찍는다.
// 그래서 프레임을 직접 만들어 밀어 넣는다. 결정적이고, LLM·관리자 설정에 기대지 않는다.
//
// 사용자 데이터는 임시 폴더를 쓴다 — 실제 앱의 프로젝트 목록·설정을 건드리지 않는다.

import { _electron as electron, type Page } from 'playwright'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeRuntimeServer } from '../tests/fake-runtime/FakeRuntimeServer'
import {
  streamEnd,
  streamStart,
  textChunk,
  thinkingChunk,
  turnEnd,
  turnStart,
  type ServerFrame,
  type TurnScriptOptions,
} from '../tests/fake-runtime/turnScript'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** 메타 레포 개발자 노트 자산 폴더 — 여기 떨어뜨리면 노트가 바로 집는다 */
// 어느 스프린트 노트로 떨어뜨릴지. 기본값은 기존 동작(sp23) 그대로다.
const SPRINT = process.env['DC_NOTE_SPRINT'] ?? 'sp23'
const OUT_DIR = join(ROOT, '..', 'davis-code', 'docs', 'site', 'develop-note', SPRINT, 'assets')

const VIEWPORT = { width: 1440, height: 900 }
const THEME_KEY = 'davis.theme'
const THEME = 'paper'

const FREEZE_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    caret-color: transparent !important;
  }
`

const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length)

/** 추론 → 답변 순으로 흐르는 턴. 실제 runtime 이 보내는 순서 그대로다. */
function thinkingTurn(options: TurnScriptOptions): ServerFrame[] {
  return [
    streamStart(options),
    turnStart(options),
    thinkingChunk(
      options,
      [
        '요청을 정리한다: 17이 소수인지 판단.',
        '',
        '소수 판정은 2부터 √17(≈4.12) 이하의 정수로 나눠보면 충분하다.',
        '  17 ÷ 2 = 8.5   → 나누어떨어지지 않음',
        '  17 ÷ 3 = 5.67  → 나누어떨어지지 않음',
        '  4는 √17 보다 크므로 더 볼 필요 없다.',
        '',
        '1과 자기 자신 외에 약수가 없으므로 소수다.',
      ].join('\n'),
    ),
    textChunk(options, '17은 소수입니다.\n\n2와 3으로 나누어떨어지지 않고, 4는 √17(약 4.12)을 넘으므로 더 확인할 필요가 없습니다.', {
      semanticType: 'reply',
    }),
    turnEnd(options),
    // 토큰을 실어 보내야 컨텍스트 사용량 바가 그려진다 (stream_end 가 정본)
    streamEnd(options, {
      terminal: true,
      failed: false,
      tokenUsage: {
        model: 'qwen3.5-122b',
        contextLength: 128_000,
        lastInputTokens: 41_600,
        contextUsageRatio: 0.325,
        effectiveWorkingWindow: 96_000,
        contextBreakdown: {
          systemPrompt: 8_200,
          agent: 1_400,
          memory: 2_600,
          skills: 3_800,
          conversation: 19_400,
          toolResults: 6_200,
        },
      },
    } as never),
  ]
}

/** 코드블록이 들어간 답변 — 코드블록 버튼(복사·적용) 캡처용. */
function codeTurn(options: TurnScriptOptions): ServerFrame[] {
  return [
    streamStart(options),
    turnStart(options),
    textChunk(
      options,
      ['간단한 소수 판정 함수입니다.', '', '```python', 'def is_prime(n: int) -> bool:', '    if n < 2:', '        return False', '    for d in range(2, int(n ** 0.5) + 1):', '        if n % d == 0:', '            return False', '    return True', '```'].join('\n'),
      { semanticType: 'reply' },
    ),
    turnEnd(options),
    streamEnd(options, { terminal: true, failed: false }),
  ]
}

/** working_dir_state push — 에이전트가 작업 경로를 워크스페이스 밖으로 옮긴 상황. */
const WORKING_DIR_PUSH: ServerFrame = {
  kind: 'workspace',
  action: 'working_dir_state',
  data: {
    active: true,
    kind: 'external',
    path: '/Users/demo/reference-docs/api-spec',
    projectName: 'external:api-spec',
  },
}

// 사용자 알림 push (ADR-053). 골든 픽스처 notification.notify.agent 를 한글로 옮긴 것.
const NOTIFY_PUSH: ServerFrame = {
  kind: 'notification',
  action: 'notify',
  data: {
    title: '테스트 완료',
    message: '128건 모두 통과했습니다. 커버리지 91%.',
    source: 'agent',
    status: 'normal',
    refId: null,
    attachments: [],
  },
}

interface Scene {
  name: string
  file: string
  run(page: Page, server: FakeRuntimeServer): Promise<void>
  /**
   * 찍기 직전 모달 닫기를 건너뛴다.
   * 슬래시 메뉴처럼 **찍고 싶은 것이 팝업 자체**인 장면은 Escape 한 번에 사라진다.
   */
  keepOverlay?: boolean
}

const SCENES: Scene[] = [
  {
    name: 'thinking-collapsed',
    file: 'ide-01-thinking-collapsed-desktop.png',
    async run(page) {
      await ask(page, '17이 소수인지 알려줘')
      // 턴이 끝나면 턴 노드로 접히면서 추론 블록이 감춰진다 — 턴을 먼저 펼친다
      await page.waitForSelector('.cc-turn-toggle', { timeout: 30_000 })
      await expandTurn(page)
      await page.waitForSelector('.thinking-block', { timeout: 15_000 })
      await page.waitForTimeout(600)
    },
  },
  {
    name: 'thinking-expanded',
    file: 'ide-01-thinking-expanded-desktop.png',
    async run(page) {
      await expandTurn(page)
      await page.locator('.thinking-toggle').last().click()
      await page.waitForSelector('.thinking-body', { timeout: 10_000 })
      await page.waitForTimeout(400)
    },
  },
  {
    name: 'context-bar',
    file: 'ide-03-context-usage-desktop.png',
    keepOverlay: true,
    async run(page) {
      // stream_end 의 tokenUsage 로 이미 그려져 있다. 분해 팝오버까지 펼쳐 보여준다.
      await page.waitForSelector('.context-bar', { timeout: 15_000 })
      await page.locator('.context-bar__summary').click()
      await page.waitForSelector('.context-bar__detail', { timeout: 10_000 })
      await page.waitForTimeout(400)
    },
  },
  {
    name: 'workdir',
    file: 'ide-04-workdir-bar-desktop.png',
    async run(page, server) {
      server.push([WORKING_DIR_PUSH])
      await page.waitForSelector('.workdir-bar', { timeout: 15_000 })
      await page.waitForTimeout(400)
    },
  },
  {
    name: 'notification',
    file: 'ide-02-notification-toast-desktop.png',
    // 토스트는 3초 뒤 스스로 사라진다. closeModal(Escape)을 거치면 그만큼 늦어져
    // 빈 화면이 찍히므로 keepOverlay 로 건너뛰고 밀어 넣자마자 찍는다.
    keepOverlay: true,
    async run(page, server) {
      server.push([NOTIFY_PUSH])
      await page.waitForSelector('.toast-stack .toast', { timeout: 10_000 })
      await page.waitForTimeout(250)
    },
  },
  {
    name: 'slash',
    file: 'ide-05-slash-menu-desktop.png',
    keepOverlay: true,
    async run(page) {
      const box = page.locator('.composer__input, textarea').first()
      await box.click()
      await box.fill('')
      await box.type('/', { delay: 40 })
      await page.waitForSelector('.dc-mentions', { timeout: 10_000 })
      await page.waitForTimeout(400)
    },
  },
  {
    name: 'slash-items',
    file: 'ide-05-slash-items-desktop.png',
    keepOverlay: true,
    async run(page) {
      // 2단계 — 카테고리 안으로 들어가면 그 종류만 남는다
      const box = page.locator('.composer__input, textarea').first()
      await box.click()
      await box.fill('')
      await box.type('/command ', { delay: 30 })
      await page.waitForSelector('.dc-mentions', { timeout: 10_000 })
      await page.waitForTimeout(400)
    },
  },
  {
    name: 'mcp',
    file: 'ide-08-mcp-credentials-desktop.png',
    async run(page) {
      await closeModal(page)
      await page.keyboard.press('Meta+,')
      await page.waitForSelector('.dc-settings', { timeout: 15_000 })
      const mcp = page.locator('.dc-settings__navitem', { hasText: 'MCP' }).first()
      if (await mcp.count()) await mcp.click()
      await page.waitForSelector('.dc-mcp', { timeout: 10_000 })
      await page.waitForTimeout(500)
    },
  },
  {
    name: 'codeblock',
    file: 'ide-09-code-block-desktop.png',
    async run(page) {
      await closeModal(page)
      await ask(page, '소수 판정 코드 보여줘')
      await page.waitForSelector('pre code, .cc-code', { timeout: 30_000 })
      await expandTurn(page)
      await page.waitForTimeout(600)
    },
  },
]

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const scenes = only ? SCENES.filter((s) => s.name.startsWith(only)) : SCENES
  if (scenes.length === 0) {
    console.log(`장면 없음: --only=${only}`)
    return
  }

  let turnSeq = 0
  const server = new FakeRuntimeServer({
    onChatRequest: ({ reqId, chatId, streamId, query }) => {
      turnSeq += 1
      const options = { reqId, chatId, streamId, turnId: `turn-${turnSeq}` }
      // 질문에 '코드' 가 있으면 코드블록 답변으로 — 장면마다 다른 턴이 필요하다
      return query.includes('코드') ? codeTurn(options) : thinkingTurn(options)
    },
  })
  const port = await server.start()
  console.log(`· 가짜 런타임 :${port}`)

  const userData = await seedUserData(port)
  const app = await electron.launch({ args: [ROOT, `--user-data-dir=${userData}`] })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.setViewportSize(VIEWPORT)
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [THEME_KEY, THEME])
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await page.addStyleTag({ content: FREEZE_CSS })
  await page.waitForSelector('.composer-bar, .dc-empty, .dc-modal__card', { timeout: 60_000 })
  if (process.argv.includes('--debug')) {
    await page.screenshot({ path: join(OUT_DIR, '_debug-initial.png') })
    const classes = await page.evaluate(() =>
      Array.from(document.querySelectorAll('body *'))
        .map((el) => el.className)
        .filter((c): c is string => typeof c === 'string' && c.length > 0)
        .slice(0, 80),
    )
    console.log('· 초기 화면 클래스:', Array.from(new Set(classes)).join(' | '))
  }
  await openProject(page)
  await waitReady(page)

  const failed: string[] = []
  for (const scene of scenes) {
    try {
      await closeModal(page)
      await scene.run(page, server)
      // 안내 모달이 화면을 가리면 캡처가 못 쓰게 된다 — 찍기 직전에 한 번 더 닫는다.
      // 단 팝업 자체가 피사체인 장면은 건드리면 안 된다.
      if (!scene.keepOverlay) await closeModal(page)
      await page.screenshot({ path: join(OUT_DIR, scene.file) })
      console.log(`✓ ${scene.file}`)
    } catch (error) {
      failed.push(scene.file)
      console.log(`✗ ${scene.file} — ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  await app.close()
  await server.stop()
  if (failed.length) {
    console.log(`\n실패 ${failed.length}건: ${failed.join(', ')}`)
    process.exitCode = 1
  }
}

/** 임시 사용자 데이터 — 실제 앱 상태를 건드리지 않으려고 매번 새로 만든다. */
async function seedUserData(port: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dc-shots-'))
  const settings = {
    // 앱은 연결 전에 Admin 주소를 요구한다(자가 진단 1단계). 런타임 연결 자체는
    // launchRuntime:false + runtimePort 로 가짜 서버에 고정되므로 여기는 통과용이다.
    adminApiUrl: process.env['DC_ADMIN_URL'] ?? 'http://43.202.185.194/api',
    language: 'ko',
    runtimePort: port,
    // 설치·기동을 하지 않고 이 포트에 떠 있는 것에 붙기만 한다 (runtimeSetup: attachOnly)
    launchRuntime: false,
    autoUpdateCheck: false,
    updateStableOnly: true,
    announcementPush: false,
    taskDoneNotify: true, // 알림 토스트 장면(notification)이 이 토글에 매여 있다
    developerMode: true,
  }
  // projects.json 은 배열이 아니라 {projects, openIds, activeId} 객체다 (projectStore.ts).
  // 배열로 쓰면 normalize 가 빈 상태로 떨어뜨려 런처 화면이 뜬다.
  const id = '00000000-0000-4000-8000-000000000001'
  const projects = {
    projects: [
      { id, root: ROOT, name: 'davis-code-desktop', favorite: true, lastOpenedAt: 1, licenseKey: 'gateway' },
    ],
    openIds: [id],
    activeId: id,
  }
  await writeFile(join(dir, 'settings.json'), JSON.stringify(settings, null, 2), 'utf-8')
  await writeFile(join(dir, 'projects.json'), JSON.stringify(projects, null, 2), 'utf-8')
  return dir
}

/** 런처 화면이면 프로젝트를 연다. 이미 열려 있으면 아무것도 하지 않는다. */
async function openProject(page: Page): Promise<void> {
  if ((await page.locator('.composer-bar').count()) > 0) return
  const card = page.locator('.dc-empty button, .dc-launcher__item, .dc-project-card').first()
  if (await card.count()) {
    await card.click()
    await page.waitForSelector('.composer-bar', { timeout: 30_000 })
  }
}

/**
 * 세션이 붙을 때까지 기다린다.
 *
 * 첫 연결이 한 번 끊긴 채로 멈춰 있는 경우가 있는데, **연결 팝업을 여는 것 자체가
 * 자가 진단과 재연결을 돌린다**. 그래서 그냥 기다리기만 하면 영영 안 붙고,
 * 한 번 열었다 닫아주면 살아난다 (guide-shots 의 ensureConnected 와 같은 처방).
 */
async function waitReady(page: Page): Promise<void> {
  if (await pollEnabled(page, 15)) return

  await page.locator('.dc-sidebar__status').click().catch(() => {})
  await page.waitForSelector('.dc-doctor__empty, .dc-doctor__list', { timeout: 60_000 }).catch(() => {})
  await page.waitForTimeout(3000)
  await closeModal(page)

  if (await pollEnabled(page, 30)) return

  await page.screenshot({ path: join(OUT_DIR, '_debug-notready.png') })
  throw new Error('세션이 준비되지 않았습니다 (가짜 런타임 핸드셰이크 확인) → _debug-notready.png')
}

async function pollEnabled(page: Page, seconds: number): Promise<boolean> {
  const input = page.locator('.composer__input, textarea').first()
  for (let i = 0; i < seconds; i += 1) {
    if (await input.isEnabled().catch(() => false)) return true
    await page.waitForTimeout(1000)
  }
  return false
}

/** 마지막 턴을 펼친다. 이미 펼쳐져 있으면 그대로 둔다 (다시 누르면 접힌다). */
async function expandTurn(page: Page): Promise<void> {
  const toggle = page.locator('.cc-turn-toggle').last()
  if ((await toggle.count()) === 0) return
  const expanded = await toggle.evaluate((el) => el.classList.contains('cc-turn-toggle--expanded'))
  if (expanded) return
  await toggle.click()
  await page.waitForTimeout(400)
}

/** 열려 있는 모달·메뉴를 닫는다. 하나라도 남으면 다음 클릭이 막힌다. */
async function closeModal(page: Page): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(120)
  }
  const close = page.locator('.dc-modal__close')
  if (await close.count()) await close.first().click().catch(() => {})
  await page.waitForTimeout(200)
}

async function ask(page: Page, text: string): Promise<void> {
  await closeModal(page)
  const box = page.locator('.composer__input, textarea').first()
  await box.click()
  await box.fill('')
  await box.type(text, { delay: 5 })
  await page.keyboard.press('Enter')
}

await main()
