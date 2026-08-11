// 사용 가이드 스크린샷 촬영 (스펙: _workspace/12_spec_guide.md).
//
// 실제 앱을 띄워 장면마다 상태를 만들고 찍는다. 장면 목록은 **데이터**라서
// 화면 하나가 바뀌면 `--only=01-` 처럼 그 장면만 다시 찍으면 된다.
//
//   npm run build          # dist / dist-electron 이 있어야 앱이 뜬다
//   npm run guide:shots               # 전부
//   npm run guide:shots -- --only=01  # 접두사로 골라서
//   npm run guide:shots -- --list     # 장면 목록만 보기
//
// 실서버에 연결된 상태를 전제로 한다 (스펙: 캡처 규격). 연결이 안 돼 있으면
// 진단 화면이 실패 그림으로 찍히므로, 정상 화면 장면은 연결 확인 후에 돌린다.

import { _electron as electron } from 'playwright'
import { mkdir, copyFile, rm, access, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'docs', 'guide', 'images')

const APP_DATA = join(homedir(), 'Library', 'Application Support', 'davis-code-desktop')

/**
 * 촬영이 건드리는 상태 파일들 — 시작 시 백업하고 끝나면 되돌린다.
 * - settings.json: 테마·언어를 촬영용으로 바꾼다
 * - projects.json: 런처 화면 장면이 열린 프로젝트를 모두 닫는다.
 *   되돌리지 않으면 **작업하던 탭이 전부 닫힌 채로 끝난다** (실측으로 겪었다)
 */
const STATE_FILES = [join(APP_DATA, 'settings.json'), join(APP_DATA, 'projects.json')]

/** 스펙: 1440×900, 2배 해상도 */
const VIEWPORT = { width: 1440, height: 900 }

/** 스펙: 모든 장면은 페이퍼 화이트 테마 (localStorage 에 남는 값) */
const THEME = 'paper'
const THEME_KEY = 'davis.theme'

/**
 * 장면 하나.
 * - `file`   저장 이름 (images/ 아래)
 * - `setup`  화면 상태를 만든다. 필요하면 여기서 클릭·입력한다.
 * - `highlight` 있으면 **전체 창을 찍되 그 요소를 네모 박스로 강조**한다.
 *   가이드는 "화면 어디를 보라"를 알려줘야 해서, 잘라낸 조각보다 전체 맥락이 낫다.
 * - `after`  뒷정리 (열어 둔 팝업 닫기 등). 다음 장면이 깨끗한 화면에서 시작하게.
 */
const SCENES = [
  // ── 1장 연결과 진단 ─────────────────────────────────────────────
  {
    file: '01-connect-dialog.png',
    highlight: '.dc-modal__card',
    setup: async (page) => {
      await openConnectDialog(page)
      // 진단이 끝나 판정 문구가 뜰 때까지 기다린다 — 도는 중을 찍으면 매번 그림이 다르다
      await page.waitForSelector('.dc-doctor__empty, .dc-doctor__list', { timeout: 60_000 })
    },
    after: closeModal,
  },
  {
    file: '01-doctor-ok.png',
    highlight: '.dc-doctor__col--diag',
    setup: async (page) => {
      await openConnectDialog(page)
      await page.waitForSelector('.dc-doctor__empty', { timeout: 60_000 })
    },
    after: closeModal,
  },
  {
    file: '01-backend-url.png',
    highlight: '.dc-settings__field:has(input[aria-label="Backend URL"])',
    setup: openConnectDialog,
    after: closeModal,
  },
  {
    file: '01-license-field.png',
    highlight: '.dc-settings__field:has(input[aria-label="라이선스 키"])',
    setup: openConnectDialog,
    after: closeModal,
  },
  {
    file: '01-license-ok.png',
    highlight: '.dc-settings__field:has(input[aria-label="라이선스 키"])',
    setup: async (page) => {
      await openConnectDialog(page)
      await page.getByRole('button', { name: '검증' }).click()
      await page.waitForSelector('.dc-settings__check--ok', { timeout: 30_000 })
    },
    after: closeModal,
  },
  {
    file: '01-license-fail.png',
    highlight: '.dc-doctor__col:not(.dc-doctor__col--diag)',
    setup: async (page) => {
      await openConnectDialog(page)
      const key = page.locator('input[aria-label="라이선스 키"]')
      await key.fill('WRONG-KEY-FOR-GUIDE')
      await page.getByRole('button', { name: '검증' }).click()
      await page.waitForSelector('.dc-settings__check--bad', { timeout: 30_000 })
    },
    // 잘못된 키를 저장하지 않고 닫는다 — 저장은 "연결 시도" 를 눌러야만 일어난다
    after: closeModal,
  },
  {
    file: '01-port.png',
    highlight: '.dc-settings__field:has(input[aria-label="시작 포트"])',
    setup: openConnectDialog,
    after: closeModal,
  },

  // ── 2장 프로젝트 ────────────────────────────────────────────────
  { file: '02-window.png', setup: closeModal },
  {
    file: '02-sidebar-files.png',
    highlight: '.dc-sidebar',
    setup: (page) => selectPanel(page, '프로젝트'),
  },
  {
    file: '02-sidebar-git.png',
    highlight: '.dc-sidebar',
    setup: (page) => selectPanel(page, '소스 관리'),
  },
  {
    file: '02-sidebar-history.png',
    highlight: '.dc-sidebar',
    setup: (page) => selectPanel(page, '채팅이력'),
  },
  {
    file: '02-panel-select.png',
    highlight: '.dc-panel-select',
    setup: async (page) => {
      await page.locator('.dc-panel-select__toggle').click()
      await page.waitForSelector('.dc-panel-select__menu')
    },
    after: (page) => page.keyboard.press('Escape'),
  },
  { file: '02-project-tabs.png', highlight: '.project-tabs', setup: closeModal },

  // ── 4장 입력창 ──────────────────────────────────────────────────
  { file: '04-composer.png', highlight: '.composer-bar', setup: closeModal },
  {
    file: '04-mention-dirs.png',
    highlight: '.dc-mentions',
    setup: (page) => typeInComposer(page, '@src'),
    after: clearComposer,
  },
  {
    file: '04-mention-drill.png',
    highlight: '.dc-mentions',
    setup: (page) => typeInComposer(page, '@src/'),
    after: clearComposer,
  },
  {
    file: '04-slash.png',
    highlight: '.dc-mentions',
    setup: (page) => typeInComposer(page, '/'),
    after: clearComposer,
  },
  {
    file: '04-open-list.png',
    highlight: '.dc-mentions',
    setup: (page) => typeInComposer(page, '/open '),
    after: clearComposer,
  },
  {
    file: '04-attach-menu.png',
    highlight: '.composer-add',
    setup: async (page) => {
      await page.locator('.composer-add__toggle').click()
      await page.waitForSelector('.composer-add__menu')
    },
    after: (page) => page.keyboard.press('Escape'),
  },
  { file: '04-mode-default.png', highlight: '.modes', setup: closeModal },
  {
    file: '04-mode-list.png',
    highlight: '.modes',
    setup: async (page) => {
      await closeModal(page)
      await page.locator('.modes-btn').click()
      await page.waitForSelector('.modes-menu, .modes-panel, [role="listbox"]')
    },
    after: (page) => page.keyboard.press('Escape'),
  },

  // ── 6장 파일과 탭 ───────────────────────────────────────────────
  { file: '06-main-tabs.png', highlight: '.main-tabs', setup: closeModal },
  { file: '06-file-tree.png', highlight: '.dc-tree', setup: (page) => selectPanel(page, '프로젝트') },
  {
    file: '06-quick-open.png',
    highlight: '.dc-palette',
    setup: async (page) => {
      await page.keyboard.press('Meta+p')
      await page.waitForSelector('input[aria-label="파일 이름"]')
      await page.locator('input[aria-label="파일 이름"]').fill('doctor')
      await page.waitForTimeout(200)
    },
    after: (page) => page.keyboard.press('Escape'),
  },
  {
    file: '06-search.png',
    highlight: '.dc-palette',
    setup: async (page) => {
      await page.keyboard.press('Meta+Shift+f')
      await page.waitForSelector('input[aria-label="찾을 내용"]')
      await page.locator('input[aria-label="찾을 내용"]').fill('라이선스')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(1500)
    },
    after: (page) => page.keyboard.press('Escape'),
  },

  // ── 7장 Git ─────────────────────────────────────────────────────
  { file: '07-changes.png', highlight: '.git-panel', setup: (page) => selectPanel(page, '소스 관리') },

  // ── 9장 설정 ────────────────────────────────────────────────────
  {
    file: '09-display.png',
    highlight: '.dc-settings',
    setup: (page) => openSettings(page, '화면'),
    after: closeModal,
  },
  {
    file: '09-theme-list.png',
    highlight: '.dc-settings__section',
    setup: async (page) => {
      await openSettings(page, '화면')
      await page.locator('.dc-select__toggle').first().click()
      await page.waitForSelector('.dc-select__menu')
    },
    after: closeModal,
  },
  {
    file: '09-update.png',
    highlight: '.dc-settings',
    setup: (page) => openSettings(page, '업데이트'),
    after: closeModal,
  },
  {
    file: '09-notify.png',
    highlight: '.dc-settings',
    setup: (page) => openSettings(page, '알림'),
    after: closeModal,
  },
  {
    file: '09-shortcuts.png',
    highlight: '.dc-settings',
    setup: (page) => openSettings(page, '단축키'),
    after: closeModal,
  },
  {
    file: 'A-shortcuts-full.png',
    highlight: '.dc-settings__body',
    setup: (page) => openSettings(page, '단축키'),
    after: closeModal,
  },

  // ── 11장 문제 해결 ──────────────────────────────────────────────
  {
    file: '11-feedback.png',
    highlight: '.dc-modal__card',
    setup: async (page) => {
      await page.locator('.app-menu__toggle').click()
      await page.getByRole('menuitem', { name: '피드백 보내기…' }).click()
      await page.waitForSelector('[aria-label="피드백 보내기"] .dc-modal__card')
    },
    after: closeModal,
  },

  // ── 추가 자동 장면 ───────────────────────────────────────────────
  {
    file: '04-mention-files.png',
    highlight: '.dc-mentions',
    setup: (page) => typeInComposer(page, '@doctor'),
    after: clearComposer,
  },
  {
    file: '04-model-switch.png',
    highlight: '.composer__tools',
    setup: closeModal,
  },
  {
    file: '04-shell.png',
    highlight: '.composer__input, textarea',
    setup: (page) => typeInComposer(page, '!git status --short'),
    after: clearComposer,
  },
  {
    file: '03-history-list.png',
    highlight: '.dc-sidebar',
    setup: (page) => selectPanel(page, '채팅이력'),
  },
  {
    file: '07-branch-bar.png',
    highlight: '.git-bar',
    setup: (page) => selectPanel(page, '소스 관리'),
  },
  {
    file: '07-commit.png',
    highlight: '.git-commit',
    setup: (page) => selectPanel(page, '소스 관리'),
  },
  {
    file: '08-skill-picker.png',
    highlight: '.dc-modal__card, [aria-label="스킬"] > *',
    setup: async (page) => {
      await closeModal(page)
      await page.locator('.composer-add__toggle').click()
      await page.locator('.composer-add__item', { hasText: '스킬' }).first().click()
      await page.waitForSelector('[aria-label="스킬"]')
      await page.waitForTimeout(600)
    },
    after: closeModal,
  },
  {
    file: '08-mcp-list.png',
    highlight: '.dc-settings',
    setup: async (page) => {
      await closeModal(page)
      await page.locator('.composer-add__toggle').click()
      await page.locator('.composer-add__item', { hasText: '커넥터' }).first().click()
      await page.waitForSelector('[aria-label="커넥터"]')
      await page.waitForTimeout(800)
    },
    after: closeModal,
  },
  {
    file: '06-file-viewer.png',
    highlight: '.main-tabs',
    setup: async (page) => {
      await closeModal(page)
      await page.keyboard.press('Meta+p')
      await page.waitForSelector('input[aria-label="파일 이름"]')
      await page.locator('input[aria-label="파일 이름"]').fill('README.md')
      await page.waitForTimeout(400)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(800)
    },
  },
  {
    file: '09-lang-en.png',
    highlight: '.dc-settings',
    setup: (page) => switchLanguage(page, 'en'),
  },
  {
    file: '09-lang-zh.png',
    highlight: '.dc-settings',
    setup: (page) => switchLanguage(page, 'zh'),
  },
  {
    file: '09-lang-ko.png',
    highlight: '.dc-settings',
    setup: (page) => switchLanguage(page, 'ko'),
    after: closeModal,
  },
  {
    file: '12-devmode-on.png',
    highlight: '.chat-messages',
    setup: (page) => sendPhrase(page, '내가 김다은이다'),
  },
  {
    file: '12-devmode-menu.png',
    highlight: '.app-menu',
    setup: async (page) => {
      await page.locator('.app-menu__toggle').click()
      await page.waitForSelector('.app-menu__panel')
    },
    after: (page) => page.keyboard.press('Escape'),
  },
  {
    file: '01-nolaunch.png',
    highlight: '.dc-settings__toggle',
    setup: async (page) => {
      // 이 체크박스는 개발자 모드에서만 보인다 — 장면 스스로 켠다 (순서에 기대지 않게)
      await sendPhrase(page, '내가 김다은이다')
      await openConnectDialog(page)
      await page.waitForSelector('.dc-settings__toggle')
    },
    after: closeModal,
  },
  {
    file: '12-devmode-off.png',
    highlight: '.chat-messages',
    setup: (page) => sendPhrase(page, '내가 김도은이다'),
  },
  {
    file: '03-announcement.png',
    highlight: '.dc-announcement, .chat-messages',
    setup: async (page, app) => {
      await closeModal(page)
      const projectId = await page.evaluate(async () => {
        const state = await window.davis.listProjects()
        return state.activeId ?? state.open?.[0]?.id ?? null
      })
      await app.evaluate(
        ({ BrowserWindow }, scoped) => {
          BrowserWindow.getAllWindows()[0]?.webContents.send('announcement:push', scoped)
        },
        {
          projectId,
          payload: {
            id: 'guide-notice-1',
            title: '런타임 v3.4.4 가 배포되었습니다',
            content: '설정 → 업데이트에서 받을 수 있습니다.',
            priority: 'normal',
            category: 'update',
          },
        },
      )
      await page.waitForTimeout(800)
    },
  },
  {
    file: '04-compact.png',
    highlight: '.composer__input, textarea',
    setup: (page) => typeInComposer(page, '/compact'),
    after: clearComposer,
  },
  {
    file: '04-rename.png',
    highlight: '.composer__input, textarea',
    setup: (page) => typeInComposer(page, '/rename 연결 진단 정리'),
    after: clearComposer,
  },
  {
    file: '02-sidebar-resize.png',
    highlight: '.sidebar-resizer',
    setup: (page) => selectPanel(page, '프로젝트'),
  },
  {
    file: '03-history-rename.png',
    highlight: '.dc-sidebar',
    setup: async (page) => {
      await selectPanel(page, '채팅이력')
      const rename = page.locator('.dc-history__rename, .dc-sidebar button[title*="이름"]').first()
      await rename.click().catch(() => {})
      await page.waitForTimeout(600)
    },
    after: (page) => page.keyboard.press('Escape'),
  },
  {
    file: '08-mcp-credentials.png',
    highlight: '.dc-settings',
    setup: async (page) => {
      await closeModal(page)
      await page.locator('.composer-add__toggle').click()
      await page.locator('.composer-add__item', { hasText: '커넥터' }).first().click()
      await page.waitForSelector('[aria-label="커넥터"]')
      await page.waitForTimeout(800)
      // 첫 커넥터를 펴서 자격 증명 입력칸을 보인다
      await page.locator('[aria-label="커넥터"] .dc-settings__navitem, [aria-label="커넥터"] button').nth(1).click().catch(() => {})
      await page.waitForTimeout(600)
    },
    after: closeModal,
  },
  {
    file: '01-doctor-healing.png',
    highlight: '.dc-doctor__col--diag',
    setup: async (page) => {
      await closeModal(page)
      // 세션을 한 번 끊고 곧바로 진단을 연다 — 자동 복구(재연결)가 도는 화면이 나온다
      await page.evaluate(() => window.davis.reconnectProject())
      await page.waitForTimeout(300)
      await openConnectDialog(page)
      await page.waitForSelector('.dc-doctor__halt', { timeout: 30_000 })
      await page.waitForTimeout(600)
    },
  },
  {
    file: '01-doctor-healed.png',
    highlight: '.dc-doctor__col--diag',
    setup: async (page) => {
      await openConnectDialog(page)
      await page.waitForSelector('.dc-doctor__empty', { timeout: 120_000 })
    },
    after: closeModal,
  },
  {
    file: '01-install-from-file.png',
    highlight: '.dc-settings__field',
    setup: (page) => openSettings(page, '업데이트'),
    after: closeModal,
  },
  {
    // 열린 프로젝트를 전부 닫아 런처 화면을 만든다. 뒤에서 원래대로 다시 연다.
    file: '02-empty-state.png',
    setup: async (page) => {
      await closeModal(page)
      const roots = await page.evaluate(async () => {
        const state = await window.davis.listProjects()
        const open = state.open ?? []
        // 이미 다 닫힌 상태로 시작할 수도 있다 (앞 촬영이 중간에 끝난 경우) —
        // 그때는 최근 목록 위쪽을 되살릴 대상으로 삼는다
        const targets = open.length > 0 ? open : (state.recent ?? []).slice(0, 3)
        for (const project of open) await window.davis.closeProject({ id: project.id })
        return targets.map((project) => project.root)
      })
      await page.evaluate((list) => ((window).__guideReopen = list), roots)
      await page.waitForTimeout(1200)
    },
    after: async (page) => {
      // 이 장면이 스스로 되돌린다 — 뒤 장면을 안 돌려도 작업 상태가 남지 않게
      await page.evaluate(async () => {
        const list = (window).__guideReopen ?? []
        for (const root of list) await window.davis.openProject({ root })
      })
      await page.waitForTimeout(2500)
    },
  },
  {
    file: '02-recent-favorite.png',
    highlight: '.dc-empty, main',
    setup: async (page) => {
      await closeModal(page)
      const roots = await page.evaluate(async () => {
        const state = await window.davis.listProjects()
        const open = state.open ?? []
        const targets = open.length > 0 ? open : (state.recent ?? []).slice(0, 3)
        for (const project of open) await window.davis.closeProject({ id: project.id })
        return targets.map((project) => project.root)
      })
      await page.evaluate((list) => ((window).__guideReopen = list), roots)
      await page.waitForTimeout(1500)
    },
    after: async (page) => {
      await page.evaluate(async () => {
        const list = (window).__guideReopen ?? []
        for (const root of list) await window.davis.openProject({ root })
      })
      await page.waitForTimeout(2500)
    },
  },
  {
    file: '01-install-banner.png',
    highlight: '.chat-messages, main',
    setup: async (page, app) => {
      await closeModal(page)
      const projectId = await page.evaluate(async () => {
        const state = await window.davis.listProjects()
        return state.activeId ?? state.open?.[0]?.id ?? null
      })
      // 배너는 런타임 상태만 보고 그린다 — 15GB 를 지울 필요 없이 상태만 넣는다
      await app.evaluate(
        ({ BrowserWindow }, scoped) => {
          BrowserWindow.getAllWindows()[0]?.webContents.send('runtime:state', scoped)
        },
        {
          projectId,
          payload: { status: 'failed', reason: '설치된 런타임을 찾지 못했습니다' },
        },
      )
      await page.waitForTimeout(800)
    },
    after: async (page, app) => {
      const projectId = await page.evaluate(async () => {
        const state = await window.davis.listProjects()
        return state.activeId ?? state.open?.[0]?.id ?? null
      })
      // 원래 상태로 되돌린다 — 배너가 남은 채로 다음 장면을 찍으면 안 된다
      await app.evaluate(
        ({ BrowserWindow }, scoped) => {
          BrowserWindow.getAllWindows()[0]?.webContents.send('runtime:state', scoped)
        },
        { projectId, payload: { status: 'running' } },
      )
      await page.waitForTimeout(400)
    },
  },
  {
    file: '03-toast.png',
    highlight: '.toast-stack',
    setup: async (page) => {
      await selectPanel(page, '채팅이력')
      // 지금 보고 있는 대화를 다시 고르면 "이미 선택된 대화입니다" 토스트가 뜬다
      const entries = page.locator('.history-item-main')
      // 한 번 골라 현재 대화로 만든 뒤, 같은 것을 다시 고르면 토스트가 뜬다
      await entries.first().click()
      await page.waitForTimeout(2500)
      await entries.first().click()
      await page.waitForTimeout(700)
    },
  },
  {
    file: '03-agent-task.png',
    highlight: '.chat-messages',
    setup: async (page, app) => {
      await closeModal(page)
      const projectId = await page.evaluate(async () => {
        const state = await window.davis.listProjects()
        return state.activeId ?? state.open?.[0]?.id ?? null
      })
      await app.evaluate(
        ({ BrowserWindow }, scoped) => {
          BrowserWindow.getAllWindows()[0]?.webContents.send('chat:snapshot', scoped)
        },
        {
          projectId,
          payload: {
            messages: [
              { role: 'user', content: '연결 진단 코드를 훑어보고 무엇이 바뀌었는지 정리해줘' },
              { role: 'assistant', content: '탐색을 서브에이전트에 맡겼습니다.' },
            ],
            turnMetas: [],
            agentTasks: [
              {
                taskId: 'guide-task-1',
                turnId: MOCK_TURN,
                agentName: 'explore',
                description: '연결 진단 관련 파일 탐색',
                status: 'success',
                text: 'doctorPipeline.ts 와 ConnectionDoctor.tsx 가 핵심입니다.',
                durationSec: 12,
                steps: [
                  { toolName: 'glob_search', done: true },
                  { toolName: 'grep_search', done: true },
                  { toolName: 'read_file', done: true },
                ],
              },
            ],
          },
        },
      )
      await page.waitForTimeout(1000)
    },
  },
  {
    file: '01-launcher-gate.png',
    highlight: '.dc-modal__card',
    setup: async (page) => {
      await closeModal(page)
      // 라이선스가 없는 **새 프로젝트**를 하나 만들어 연다 — 그때만 뜨는 등록 게이트다
      const root = join(tmpdir(), 'guide-new-project')
      await mkdir(root, { recursive: true })
      await writeFile(join(root, 'README.md'), '# 새 프로젝트\n', 'utf8')
      await page.evaluate((path) => window.davis.openProject({ root: path }), root)
      await page.waitForSelector('.dc-onboarding__intro', { timeout: 60_000 })
      await page.waitForTimeout(1500)
    },
    after: async (page) => {
      await closeModal(page)
      // 임시 프로젝트를 닫고 폴더도 지운다 (프로젝트 목록은 백업본으로 되돌아간다)
      await page.evaluate(async () => {
        const state = await window.davis.listProjects()
        const temp = (state.open ?? []).find((project) => project.name === 'guide-new-project')
        if (temp) await window.davis.closeProject({ id: temp.id })
      })
      await rm(join(tmpdir(), 'guide-new-project'), { recursive: true, force: true })
      await page.waitForTimeout(1200)
    },
  },
  {
    // 리뷰·diff 는 목으로 안 뜬다 — 실제로 파일을 바꾸는 턴이 있어야 한다.
    // 임시 파일 docs/guide/SAMPLE.md 를 대상으로 하고, 촬영이 끝나면 지운다(main 의 finally).
    file: '05-review.png',
    highlight: '.chat-messages',
    setup: async (page) => {
      await closeModal(page)
      await pickMode(page, 2) // 편집 자동 승인 — 승인 모달 없이 바로 바꾼다
      await ask(page, 'docs/guide/SAMPLE.md 파일을 만들고 본문에 "샘플 문서" 한 줄만 써줘')
      await waitTurnEnd(page)
      await page.waitForTimeout(1500)
    },
  },
  {
    file: '06-diff.png',
    highlight: '.dc-sidebar',
    setup: async (page) => {
      await waitTurnEnd(page)
      await selectPanel(page, '소스 관리')
      await page.waitForTimeout(1200)
    },
    after: async (page) => {
      await pickMode(page, 0) // 기본 모드로 되돌린다
    },
  },
  {
    file: '11-logs.png',
    highlight: '.main-tabs',
    setup: async (page) => {
      // 로그 보기는 개발자 모드에서만 메뉴에 나온다 — 장면 스스로 켠다
      await sendPhrase(page, '내가 김다은이다')
      await page.locator('.app-menu__toggle').click()
      await page.getByRole('menuitem', { name: '로그 보기' }).click()
      await page.waitForTimeout(1200)
    },
    after: (page) => sendPhrase(page, '내가 김도은이다'),
  },
  {
    file: 'C-gesture.png',
    setup: async (page) => {
      await closeModal(page)
      // 'ㄴ' — 아래로 긋고 오른쪽으로 꺾는다 (각 획 90px 이상)
      await page.mouse.move(700, 300)
      await page.mouse.down()
      for (let y = 300; y <= 520; y += 20) await page.mouse.move(700, y)
      for (let x = 700; x <= 950; x += 20) await page.mouse.move(x, 520)
      // 자취가 남아 있는 동안 찍는다 — 떼면 사라진다
    },
    after: async (page) => {
      await page.mouse.up()
      await page.waitForTimeout(400)
    },
  },

  // ── 쉬운 추가분 (대화 없이) ─────────────────────────────────────
  {
    file: '04-mode-plan.png',
    highlight: '.modes',
    setup: (page) => pickMode(page, 1),
  },
  {
    file: '04-mode-accept.png',
    highlight: '.modes',
    setup: (page) => pickMode(page, 2),
    after: (page) => pickMode(page, 0),
  },
  {
    file: '04-model-slash.png',
    highlight: '.composer__input, textarea',
    setup: (page) => typeInComposer(page, '/model '),
    after: clearComposer,
  },
  {
    file: '02-sidebar-resize.png',
    highlight: '.dc-sidebar',
    setup: (page) => selectPanel(page, '프로젝트'),
  },

  // ── 대화 대본 (사용자 선택: 정해진 질문으로 돌리며 찍는다) ──────
  // 응답 문구는 매번 조금씩 다르다. 그림의 목적은 "무엇이 어디에 나오는가" 라
  // 문구가 달라도 가이드로서는 유효하다.
  {
    file: '03-streaming-stop.png',
    highlight: '.composer-bar',
    setup: async (page) => {
      await ask(page, 'README.md 를 읽고 이 프로젝트가 무엇인지 세 줄로 요약해줘')
      // 응답이 흐르기 시작할 때 — 중단 버튼이 보이는 순간
      await page.waitForSelector('.chat-messages', { timeout: 30_000 })
      await page.waitForTimeout(2500)
    },
  },
  {
    file: '03-tool-call.png',
    highlight: '.taz-item',
    setup: async (page) => {
      await page.waitForSelector('.taz-item', { timeout: 120_000 })
      await page.waitForTimeout(500)
    },
  },
  {
    file: '03-tool-result.png',
    highlight: '.taz-item',
    setup: async (page) => {
      // 이 장면만 따로 돌릴 수도 있다 — 도구 호출이 없으면 스스로 하나 만든다
      if ((await page.locator('.taz-item').count()) === 0) {
        await ask(page, 'package.json 을 읽고 이 앱의 이름과 버전만 알려줘')
        await page.waitForSelector('.taz-item', { timeout: 180_000 })
      }
      // 응답이 흐르는 동안에는 목록이 움직여 클릭이 빗나간다 — 턴이 끝난 뒤 편다
      await waitTurnEnd(page)
      await page.locator('.taz-header').first().click()
      await page.waitForTimeout(800)
    },
  },
  {
    file: '03-context-bar.png',
    highlight: '.context-bar',
    setup: async (page) => {
      await waitTurnEnd(page)
    },
  },
  {
    file: '03-turn-anatomy.png',
    highlight: '.chat-messages',
    setup: waitTurnEnd,
  },
  // ── 승인 계열 (임시 파일 docs/guide/SAMPLE.md 를 대상으로, 끝나면 지운다) ──
  {
    file: '05-approval.png',
    highlight: '.approval-card, [aria-label="도구 실행 승인"] .dc-modal__card',
    setup: async (page, app) => {
      await closeModal(page)
      await emitTurnEvent(app, page, { type: 'turn_started', turnId: MOCK_TURN })
      await emitTurnEvent(app, page, {
        type: 'approval_requested',
        turnId: MOCK_TURN,
        requestId: 'guide-req-1',
        toolName: 'create_file',
        displayName: '파일 만들기',
        args: { path: 'docs/guide/SAMPLE.md', content: '샘플\n' },
        reason: '워크스페이스 안에 새 파일을 만듭니다',
      })
      await page.waitForSelector('.approval-allow', { timeout: 30_000 })
    },
    after: async (page) => {
      const deny = page.locator('.approval-deny')
      if (await deny.count()) await deny.first().click().catch(() => {})
      await page.waitForTimeout(400)
    },
  },
  {
    file: '05-question.png',
    highlight: '[aria-label="에이전트 질문"] .dc-modal__card, .approval-card',
    setup: async (page, app) => {
      await closeModal(page)
      await emitTurnEvent(app, page, {
        type: 'question_requested',
        turnId: MOCK_TURN,
        questionId: 'guide-q-1',
        question: '어느 파일부터 고칠까요?',
        options: ['src/App.tsx', 'src/components/ChatComposer.tsx', '둘 다'],
      })
      await page.waitForTimeout(800)
    },
    after: (page) => page.keyboard.press('Escape'),
  },
  {
    file: '05-plan.png',
    highlight: '.chat-messages, .approval-card',
    setup: async (page, app) => {
      await closeModal(page)
      await emitTurnEvent(app, page, {
        type: 'plan_requested',
        turnId: MOCK_TURN,
        planId: 'guide-plan-1',
        summary: '연결 팝업의 자가 진단 순서를 Admin → 라이선스 → 연결 상태로 바꾼다',
        filesToChange: ['src/state/doctorPipeline.ts', 'src/components/ConnectionDoctor.tsx'],
        estimatedSteps: 3,
      })
      await page.waitForTimeout(800)
    },
    after: (page) => page.keyboard.press('Escape'),
  },
  {
    file: '03-code-block.png',
    highlight: '.chat-messages',
    setup: async (page, app) => {
      await closeModal(page)
      await emitTurnEvent(app, page, { type: 'turn_started', turnId: MOCK_TURN })
      await emitTurnEvent(app, page, {
        type: 'text',
        turnId: MOCK_TURN,
        text: '진단 순서는 아래처럼 바뀌었습니다.\n\n```ts\nconst STEPS = [\n  \'admin\',   // Admin 서버 확인\n  \'license\', // 라이선스 검증\n  \'runtime\', // 연결 상태 확인\n]\n```\n\n앞 단계가 실패하면 뒤는 확인하지 않습니다.',
      })
      await emitTurnEvent(app, page, { type: 'turn_ended', turnId: MOCK_TURN, failed: false })
      await page.waitForTimeout(600)
    },
  },
  {
    file: '04-queue.png',
    highlight: '.composer-bar',
    setup: async (page, app) => {
      await closeModal(page)
      // 응답 중인 상태를 만들고 그 위로 한 줄 더 보낸다 — 대기열에 쌓인다
      await emitTurnEvent(app, page, { type: 'turn_started', turnId: 'guide-turn-2' })
      const box = page.locator('.composer__input, textarea').first()
      await box.click()
      await box.fill('이어서 단축키 표도 정리해줘')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(800)
    },
    after: async (page, app) => {
      await emitTurnEvent(app, page, { type: 'turn_ended', turnId: 'guide-turn-2', failed: false })
      await clearComposer(page)
    },
  },
  {
    file: '01-doctor-license-fail.png',
    highlight: '.dc-doctor__col--diag',
    setup: async (page) => {
      await closeModal(page)
      // 키를 잠깐 틀리게 저장했다가 진단을 돌린다 — 끝나면 원래 키로 되돌린다 (after)
      const project = await page.evaluate(async () => {
        const state = await window.davis.listProjects()
        const id = state.activeId ?? state.open?.[0]?.id
        const found = [...(state.open ?? []), ...(state.recent ?? [])].find((p) => p.id === id)
        return { id, licenseKey: found?.licenseKey ?? '' }
      })
      await page.evaluate(
        (p) => window.davis.setProjectLicense({ id: p.id, licenseKey: 'WRONG-KEY-FOR-GUIDE' }),
        project,
      )
      await page.waitForTimeout(1500)
      await openConnectDialog(page)
      await page.waitForSelector('.dc-doctor__list, .dc-doctor__empty', { timeout: 120_000 })
      return project
    },
    after: async (page) => {
      await closeModal(page)
      // 원래 키로 되돌린다 — 촬영이 프로젝트 설정을 망가뜨린 채 끝나면 안 된다
      await page.evaluate(async () => {
        const state = await window.davis.listProjects()
        const id = state.activeId ?? state.open?.[0]?.id
        if (id) await window.davis.setProjectLicense({ id, licenseKey: 'gateway' })
      })
      await page.waitForTimeout(1200)
    },
  },
  {
    file: '04-compact.png',
    highlight: '.composer__input, textarea',
    setup: (page) => typeInComposer(page, '/compact'),
    after: clearComposer,
  },
  {
    file: '04-rename.png',
    highlight: '.composer__input, textarea',
    setup: (page) => typeInComposer(page, '/rename 가이드 촬영용 대화'),
    after: clearComposer,
  },
]


/**
 * 목 턴 이벤트 주입.
 *
 * 승인·질문·계획 화면은 실제 대화로 만들려면 LLM 이 그 도구를 부를 때까지 기다려야 하고,
 * 저장소도 건드린다. 이 화면들은 **main 이 renderer 로 보내는 이벤트**로 그려지므로,
 * 같은 채널에 같은 모양의 프레임을 넣어 주면 진짜와 똑같은 화면이 나온다 (사용자 승인).
 */
async function emitTurnEvent(app, page, event) {
  const projectId = await page.evaluate(async () => {
    const state = await window.davis.listProjects()
    return state.activeId ?? state.open?.[0]?.id ?? null
  })
  if (!projectId) throw new Error('활성 프로젝트를 찾지 못했습니다')
  await app.evaluate(
    ({ BrowserWindow }, scoped) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('turn:event', scoped)
    },
    { projectId, payload: event },
  )
  await page.waitForTimeout(600)
}

const MOCK_TURN = 'guide-turn-1'

/** 권한 모드 전환 — 목록에서 index 번째를 고른다 (0 기본 / 1 계획 / 2 편집 자동 승인) */
async function pickMode(page, index) {
  await closeModal(page)
  await page.locator('.modes-btn').click()
  await page.waitForTimeout(300)
  const items = page.locator('.modes [role="option"], .modes button')
  await items.nth(index + 1).click().catch(() => {})
  await page.waitForTimeout(400)
}

/** 대본 질문을 보낸다 */
async function ask(page, question) {
  await closeModal(page)
  const box = page.locator('.composer__input, textarea').first()
  await box.click()
  await box.fill(question)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
}

/** 턴이 끝날 때까지 (중단 버튼이 사라질 때까지) */
async function waitTurnEnd(page) {
  for (let i = 0; i < 180; i += 1) {
    const busy = await page.locator('.turn-controls button, .composer-cancel').count()
    if (busy === 0) return
    await page.waitForTimeout(1000)
  }
}

/**
 * 설정 → 화면에서 UI 언어를 바꾼다. 언어는 네이티브 <select> 다.
 * 설정 파일에 남으므로 촬영이 끝나면 백업본으로 복원된다.
 */
async function switchLanguage(page, code) {
  await closeModal(page)
  await page.keyboard.press('Meta+,')
  await page.waitForSelector('.dc-settings')
  // 분류 이름은 언어를 따라 번역된다 — 첫 항목(화면/Display/画面)을 고른다
  await page.locator('.dc-settings__navitem').first().click()
  await page.locator('.dc-settings__select').selectOption(code)
  await page.waitForTimeout(700)
}

/** 이스터에그 문구를 보낸다 — 전송되지 않고 그 자리에서 응답이 남는다 */
async function sendPhrase(page, phrase) {
  await closeModal(page)
  const box = page.locator('.composer__input, textarea').first()
  await box.click()
  await box.fill(phrase)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1200)
}

/**
 * 촬영 전 연결 확보.
 *
 * 세션이 끊겨 있으면 입력창이 비활성이라 `@`·`/` 같은 장면을 아예 만들 수 없고,
 * 진단 화면도 실패 그림으로 찍힌다. 연결 팝업을 열어 자가 진단·자동 복구를 한 번 돌린다.
 */
async function ensureConnected(page) {
  // 프로젝트가 하나도 열려 있지 않으면(런처 화면) 연결할 세션 자체가 없다 — 그냥 넘어간다
  if ((await page.locator('.dc-sidebar__status').count()) === 0) {
    console.log('· 열린 프로젝트가 없습니다 — 연결 확인을 건너뜁니다')
    return
  }
  const input = page.locator('.composer__input, textarea').first()
  if (await input.isEnabled().catch(() => false)) return

  console.log('· 세션이 준비되지 않았습니다 — 연결 팝업으로 자가 진단을 돌립니다')
  await openConnectDialog(page)
  await page.waitForSelector('.dc-doctor__empty, .dc-doctor__list', { timeout: 120_000 })
  await closeModal(page)
  await input.waitFor({ state: 'visible', timeout: 60_000 })
  for (let i = 0; i < 60; i += 1) {
    if (await input.isEnabled().catch(() => false)) return
    await page.waitForTimeout(1000)
  }
  console.log('⚠ 연결되지 않은 채로 촬영합니다 — 입력창이 필요한 장면은 실패합니다')
}

/** 사이드바 패널 전환 (파일 / Git / 이력) */
async function selectPanel(page, label) {
  await closeModal(page)
  await page.locator('.dc-panel-select__toggle').click()
  await page.waitForSelector('.dc-panel-select__menu')
  await page.locator('.dc-panel-select__item', { hasText: label }).first().click()
  await page.waitForTimeout(400)
}

/** 설정 창을 열고 분류를 고른다 */
async function openSettings(page, section) {
  await closeModal(page)
  await page.keyboard.press('Meta+,')
  await page.waitForSelector('.dc-settings')
  await page.locator('.dc-settings__navitem', { hasText: section }).first().click()
  await page.waitForTimeout(300)
}

/** 입력창에 쳐서 자동완성을 띄운다 */
async function typeInComposer(page, text) {
  await closeModal(page)
  const box = page.locator('.composer__input, textarea').first()
  await box.click()
  await box.fill('')
  await box.type(text, { delay: 20 })
  await page.waitForTimeout(500)
}

async function clearComposer(page) {
  const box = page.locator('.composer__input, textarea').first()
  await box.fill('')
}

async function openConnectDialog(page) {
  const already = await page.locator('.dc-modal__card--wide').count()
  if (already > 0) return
  await page.locator('.dc-sidebar__status').click()
  await page.waitForSelector('.dc-modal__card--wide')
}

async function closeModal(page) {
  // 열려 있는 것이 팝업이든 메뉴든 전부 닫는다 — 하나라도 남으면 다음 장면의 클릭이 막힌다
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(120)
  }
  const close = page.locator('.dc-modal__close')
  if (await close.count()) await close.first().click().catch(() => {})
  await page.waitForTimeout(200)
}

/**
 * 강조 박스 — 전체 창을 찍되 "여기를 보라"를 표시한다.
 * 요소를 잘라내면 화면 어디에 있는 것인지가 사라져서, 가이드에는 전체 + 박스가 낫다.
 */
async function drawHighlight(page, selector) {
  const box = await page.locator(selector).first().boundingBox()
  if (!box) throw new Error(`강조할 요소를 찾지 못했습니다: ${selector}`)
  await page.evaluate((rect) => {
    const mark = document.createElement('div')
    mark.id = 'guide-highlight'
    Object.assign(mark.style, {
      position: 'fixed',
      left: `${rect.x - 4}px`,
      top: `${rect.y - 4}px`,
      width: `${rect.width + 8}px`,
      height: `${rect.height + 8}px`,
      border: '3px solid #ff3b30',
      borderRadius: '8px',
      boxShadow: '0 0 0 3px rgba(255, 59, 48, 0.22)',
      pointerEvents: 'none',
      zIndex: '2147483647',
    })
    document.body.appendChild(mark)
  }, box)
}

async function clearHighlight(page) {
  await page.evaluate(() => document.getElementById('guide-highlight')?.remove())
}

/** 애니메이션을 멈춘다 — 같은 장면을 다시 찍어도 같은 그림이 나와야 한다 */
const FREEZE_CSS = `*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
}`

async function main() {
  const args = process.argv.slice(2)
  const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length)
  const scenes = only ? SCENES.filter((s) => s.file.startsWith(only)) : SCENES

  if (args.includes('--list')) {
    for (const scene of SCENES) console.log(scene.file)
    return
  }
  if (scenes.length === 0) {
    console.error(`--only=${only} 에 맞는 장면이 없습니다. --list 로 확인하세요.`)
    process.exit(1)
  }

  await mkdir(OUT_DIR, { recursive: true })
  await backupState()

  const app = await electron.launch({ args: [ROOT] })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.setViewportSize(VIEWPORT)
  // 테마는 localStorage 정본이라 심고 새로 고친다 — 설정 화면을 거치지 않는다
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [THEME_KEY, THEME])
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await page.addStyleTag({ content: FREEZE_CSS })
  // 프로젝트 상태가 올라오고 첫 화면이 그려질 때까지
  await page.waitForSelector('.composer-bar, .dc-empty, .dc-modal__card', { timeout: 60_000 })
  await ensureConnected(page).catch((error) => console.log(`· 연결 확인 실패: ${error}`))

  let done = 0
  const failed = []
  try {
    for (const scene of scenes) {
      try {
        await scene.setup?.(page, app)
        if (scene.highlight) await drawHighlight(page, scene.highlight)
        await page.screenshot({ path: join(OUT_DIR, scene.file) })
        await clearHighlight(page)
        done += 1
        console.log(`✓ ${scene.file}`)
      } catch (error) {
        // 한 장면이 실패해도 나머지는 찍는다 — 무엇이 빠졌는지 끝에 모아 보고한다
        await clearHighlight(page).catch(() => {})
        failed.push({ file: scene.file, reason: String(error).split('\n')[0] })
        console.log(`✗ ${scene.file} — ${String(error).split('\n')[0]}`)
      }
      await scene.after?.(page).catch(() => {})
    }
  } finally {
    await app.close().catch(() => {})
    await restoreState()
    // 승인 장면이 만든 임시 파일은 남기지 않는다
    await rm(join(ROOT, 'docs', 'guide', 'SAMPLE.md'), { force: true })
  }
  console.log(`\n${done}/${scenes.length} 장 저장 → docs/guide/images/`)
  if (failed.length > 0) {
    console.log('\n실패한 장면:')
    for (const item of failed) console.log(`  ${item.file} — ${item.reason}`)
    process.exitCode = 1
  }
}

async function backupState() {
  for (const file of STATE_FILES) {
    try {
      await access(file)
    } catch {
      continue // 아직 없는 파일은 되돌릴 것도 없다
    }
    await copyFile(file, `${file}.guide-backup`)
  }
}

async function restoreState() {
  for (const file of STATE_FILES) {
    const backup = `${file}.guide-backup`
    try {
      await access(backup)
    } catch {
      continue
    }
    await copyFile(backup, file)
    await rm(backup, { force: true })
  }
}

await main()
