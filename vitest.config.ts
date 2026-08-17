import { defineConfig } from 'vitest/config'

// 새 Node 가 실험적 웹스토리지를 켜면 **전역 `localStorage` 를 스스로 갖는다**.
// 그 객체에는 `clear()` 가 없고 jsdom 환경 파일에서도 이쪽이 이겨서,
// `localStorage.clear is not a function` 으로 테마·사이드바 시험 24개가 깨진다.
// 끄면 jsdom 이 제 것을 깐다.
const WEBSTORAGE_OFF = '--no-experimental-webstorage'

/**
 * **이 플래그를 아는 판에서만 넘긴다.**
 *
 * 무조건 넘기던 시절 **CI 가 통째로 깨져 있었다** (Node 20). 모르는 플래그를 받으면
 * node 는 `bad option` 으로 즉사하는데, 죽는 것이 워커라 증상이
 * `Worker exited unexpectedly` 로 나온다 — **코드 버그처럼 보인다.** 로컬(22)은 초록이라
 * 며칠 동안 "CI 만 이상하다" 로 남아 있었다.
 *
 * **버전 숫자로 재지 않는다.** `>= 22.4` 같은 조건은 적은 날에만 맞고, 무엇보다 이 판이
 * 실제로 그 플래그를 받는지와 다른 질문이다. 아래는 node 가 직접 답하는 목록이라
 * 판이 바뀌어도 따라온다 (실측 2026-08-17: v20.20.2 → false · v22.18.0 → true).
 *
 * 필요 없는 판에 넘어가는 것은 무해하다 — 22.18 에는 전역 `localStorage` 가 아예 없다.
 */
const execArgv = process.allowedNodeEnvironmentFlags.has(WEBSTORAGE_OFF) ? [WEBSTORAGE_OFF] : []

export default defineConfig({
  test: {
    environment: 'node',
    poolOptions: {
      forks: { execArgv },
      threads: { execArgv },
    },
    // 확장(`extensions/`)의 시험은 **확장 옆에** 산다 — 호스트가 특정 확장을 알면 안 되고,
    // 확장이 옮겨 갈 때 시험도 같이 가야 한다.
    include: ['{src,electron,shared,tests,extensions}/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      // 실제 소스만 본다. 테스트·타입 선언·엔트리/부트스트랩·순수 배럴은 제외한다
      // (부트스트랩은 단위 테스트 대상이 아니라 커버리지를 왜곡한다).
      include: ['src/**', 'electron/**', 'shared/**'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        'src/main.tsx',
        'electron/main.ts',
        // preload 배선을 별 파일로 뗀 것(preloadGit.ts)까지 이름으로 모은다 —
        // `wiring.test.ts` 의 스캔 확대와 같은 결. 하나만 적던 시절에는 쪼갠 쪽이
        // 0% 로 남아 "안 짠 코드" 처럼 보였다.
        'electron/preload*.ts',
        'tests/**',
      ],
      reporter: ['text-summary', 'text', 'html'],
    },
  },
})
