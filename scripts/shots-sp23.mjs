// SP#23 기능 캡처 — 데스크톱 앱을 실제로 띄워 찍는다.
//
// IDE 3종 GUI 는 자동화가 안 되므로, 같은 기능을 구현한 데스크톱 앱으로 대신 찍는다.
// 결과는 메타 레포의 개발자 노트가 그대로 임베드한다.
//
//   npm run build && node scripts/shots-sp23.mjs
//   node scripts/shots-sp23.mjs --only=model     # 접두사로 골라서
//
// 전제: 프로젝트 설정에 llm_allowed_models(2개 이상)와 enable_thinking 이 켜져 있어야 한다.
// 안 그러면 모델 스위처는 숨겨지고(fail-closed) 추론 블록은 아예 오지 않는다.

import { _electron as electron } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** 메타 레포 개발자 노트 자산 폴더 — 여기 떨어뜨리면 노트가 바로 집는다 */
const OUT_DIR = join(ROOT, '..', 'davis-code', 'docs', 'site', 'develop-note', 'sp23', 'assets')

const VIEWPORT = { width: 1440, height: 900 }
const THEME_KEY = 'davis.theme'
const THEME = 'paper'

/** 애니메이션·커서 깜빡임을 멈춰 프레임마다 그림이 흔들리지 않게 한다 */
const FREEZE_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    caret-color: transparent !important;
  }
`

const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length)

const SCENES = [
  {
    name: 'model',
    file: 'ide-02-model-switch-desktop.png',
    async run(page) {
      await closeModal(page)
      const toggle = page.locator('.modes-toggle, .modes button').first()
      await toggle.click()
      await page.waitForSelector('.modes-menu', { timeout: 10_000 })
      await page.waitForTimeout(400)
    },
    after: closeModal,
  },
  {
    name: 'thinking-collapsed',
    file: 'ide-01-thinking-collapsed-desktop.png',
    async run(page) {
      await ask(page, '숫자 17이 소수인지 판단해줘. 짧게 답해.')
      // 추론 블록이 도착할 때까지 — 모델이 thinking 을 지원해야 온다
      await page.waitForSelector('.thinking-block', { timeout: 180_000 })
      await page.waitForTimeout(600)
    },
  },
  {
    name: 'thinking-expanded',
    file: 'ide-01-thinking-expanded-desktop.png',
    async run(page) {
      const toggle = page.locator('.thinking-toggle').last()
      await toggle.click()
      await page.waitForSelector('.thinking-body', { timeout: 10_000 })
      await page.waitForTimeout(400)
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

  const app = await electron.launch({ args: [ROOT] })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.setViewportSize(VIEWPORT)
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [THEME_KEY, THEME])
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await page.addStyleTag({ content: FREEZE_CSS })
  await page.waitForSelector('.composer-bar, .dc-empty, .dc-modal__card', { timeout: 60_000 })
  await waitReady(page)

  const failed = []
  for (const scene of scenes) {
    try {
      await scene.run(page)
      await page.screenshot({ path: join(OUT_DIR, scene.file) })
      console.log(`✓ ${scene.file}`)
      await scene.after?.(page)
    } catch (error) {
      failed.push(scene.file)
      console.log(`✗ ${scene.file} — ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  await app.close()
  if (failed.length) {
    console.log(`\n실패 ${failed.length}건: ${failed.join(', ')}`)
    process.exitCode = 1
  }
}

/** 입력창이 살아날 때까지 — 런타임 기동·핸드셰이크가 끝나야 한다 */
async function waitReady(page) {
  const input = page.locator('.composer__input, textarea').first()
  for (let i = 0; i < 60; i += 1) {
    if (await input.isEnabled().catch(() => false)) return
    await page.waitForTimeout(2000)
  }
  throw new Error('세션이 준비되지 않았습니다 (런타임 연결 확인 필요)')
}

async function ask(page, text) {
  await closeModal(page)
  const box = page.locator('.composer__input, textarea').first()
  await box.click()
  await box.fill('')
  await box.type(text, { delay: 10 })
  await page.keyboard.press('Enter')
}

async function closeModal(page) {
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(120)
  }
  const close = page.locator('.dc-modal__close')
  if (await close.count()) await close.first().click().catch(() => {})
  await page.waitForTimeout(200)
}

await main()
