import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Node 22+ 가 실험적 웹스토리지를 켜면서 **전역 `localStorage` 를 스스로 갖는다**.
    // 그 객체에는 `clear()` 가 없고, jsdom 환경 파일에서도 이쪽이 이겨서
    // `localStorage.clear is not a function` 으로 테마·사이드바 테스트 24개가 깨진다
    // (Node 25 로컬에서만. CI 는 Node 20 이라 안 보인다 — 그래서 더 헷갈린다).
    // 끄면 jsdom 이 제 것을 깐다.
    poolOptions: {
      forks: { execArgv: ['--no-experimental-webstorage'] },
      threads: { execArgv: ['--no-experimental-webstorage'] },
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
