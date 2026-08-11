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

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // 아직 안 떴다 — 계속 기다린다
    }
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

    console.log('[dev] vite 개발 서버 시작…')
    group.spawn('npx', ['vite'])
    await waitForServer(DEV_SERVER_URL, READY_TIMEOUT_MS)

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
