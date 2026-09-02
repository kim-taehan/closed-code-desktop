// 개발용 실행기: vite 개발 서버 + electron 을 함께 띄운다.
//
// renderer 만 띄우면 preload 브리지(window.davis)가 없어 화면이 죽는다.
// electron 은 DAVIS_DEV_SERVER_URL 이 있으면 빌드 산출물 대신 개발 서버를 로드한다.
// 새 의존성 없이 stdlib 만 쓴다 (에어갭 제약).

import { spawn } from 'node:child_process'

const DEV_SERVER_URL = 'http://localhost:5273'
const READY_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 200

/** 자식 프로세스를 모아 두고 한 번에 정리한다. */
class ProcessGroup {
  #children = []

  spawn(command, args, options = {}) {
    const child = spawn(command, args, { stdio: 'inherit', shell: false, ...options })
    this.#children.push(child)
    return child
  }

  killAll() {
    for (const child of this.#children) {
      if (!child.killed) child.kill('SIGTERM')
    }
    this.#children = []
  }
}

async function runOnce(group, command, args, label) {
  const child = group.spawn(command, args)
  const code = await new Promise((resolve) => child.once('exit', resolve))
  if (code !== 0) throw new Error(`${label} 실패 (exit ${code})`)
}

/**
 * 우리 vite 가 준비되기 전에 죽으면 그 사실을 던진다.
 *
 * ⚠️ **이것만으로는 위 사고를 못 막는다** (2026-08-27 실측). 남의 서버는 첫 폴링에
 * 곧바로 200 을 주는데 vite 가 포트 충돌로 죽는 데는 1초 넘게 걸려서, 경합은 **언제나
 * 폴링이 이긴다.** 로그에도 `electron 시작` 이 `Port ... already in use` 보다 먼저 찍혔다.
 * 그 사고를 막는 것은 `main` 의 선점 검사이고, 이 함수는 **다른 이유로 죽었을 때**
 * 30초를 기다리지 않게 해 주는 몫이다.
 */
function died(child) {
  return new Promise((_, reject) => {
    child.once('exit', (code) => {
      reject(new Error(`vite 가 준비되기 전에 죽었습니다 (exit ${code}) — ${DEV_SERVER_URL} 을 다른 프로세스가 쓰고 있는지 보세요`))
    })
  })
}

/** 그 주소에 지금 누가 답하나. **누구인지는 안 묻는다** — 그래서 아래 선점 검사가 필요하다 */
async function responds(url) {
  try {
    return (await fetch(url)).ok
  } catch {
    return false
  }
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await responds(url)) return
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(`개발 서버가 ${timeoutMs}ms 안에 뜨지 않았습니다: ${url}`)
}

async function main() {
  const group = new ProcessGroup()
  const stop = () => {
    group.killAll()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  try {
    // electron main/preload 는 번들러를 안 거치므로 먼저 컴파일해야 한다
    console.log('[dev] electron 컴파일 중…')
    await runOnce(group, 'npx', ['tsc', '-p', 'tsconfig.electron.json'], 'electron 컴파일')

    // **띄우기 전에 물어본다.** 이미 누가 답하면 그건 우리 vite 가 아니다.
    //
    // vite 는 `strictPort` 라 포트를 옮기지 않고 죽는데, 아래 폴링은 "누가 답하나" 만 보므로
    // **남의 서버를 우리 것으로 읽는다.** 그러면 electron 이 떠서 다른 앱의 렌더러를
    // 이 앱의 메인 프로세스에 붙인다 — 2026-08-27 에 실제로 그렇게 떴고, 증상이
    // "우리 앱인데 화면이 남의 것" 이라 원인을 찾기 어려웠다.
    if (await responds(DEV_SERVER_URL)) {
      throw new Error(
        `${DEV_SERVER_URL} 을 이미 다른 프로세스가 쓰고 있습니다. ` +
          '그 프로세스를 끄고 다시 실행하세요 (vite 는 strictPort 라 포트를 옮기지 않습니다).',
      )
    }

    console.log('[dev] vite 개발 서버 시작…')
    const vite = group.spawn('npx', ['vite'])
    await Promise.race([waitForServer(DEV_SERVER_URL, READY_TIMEOUT_MS), died(vite)])

    console.log(`[dev] electron 시작 (${DEV_SERVER_URL})`)
    const electron = group.spawn('npx', ['electron', '.'], {
      env: { ...process.env, DAVIS_DEV_SERVER_URL: DEV_SERVER_URL },
    })

    // 앱 창을 닫으면 개발 서버도 함께 내린다
    electron.once('exit', stop)
  } catch (error) {
    console.error(`[dev] ${error.message}`)
    group.killAll()
    process.exit(1)
  }
}

void main()
