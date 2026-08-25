#!/usr/bin/env node
// opencode 실행 파일을 npm 레지스트리에서 받아 `build/vendor/opencode/<타깃>/` 에 놓는다.
// electron-builder 가 이 자리를 `extraResources` 로 앱 안에 싣는다 (`electron-builder.yml`).
//
// **이 스크립트는 망 밖(개발 머신·CI)에서만 돈다.** 폐쇄망 현장에는 npm 이 없고, 그래서
// 실행 파일이 앱 아티팩트에 실려 들어가야 한다 (`_workspace/17_plan_opencode_bundle.md`).
//
// 받은 것은 **레포에 커밋하지 않는다** — 137MB 다. `build/vendor/` 는 gitignore 에 있다.
//
// ## 배포 형태 (2026-08-25 실측)
//
// `opencode-ai` 는 실행 파일을 담고 있지 않다 — 파일 4개짜리 런처이고, 실물은
// **플랫폼별 optionalDependency** 로 갈려 있다 (`opencode-darwin-arm64` 등 12종).
// 그래서 여기서는 런처를 거치지 않고 **플랫폼 패키지를 직접** 받는다. 각 tarball 은
// 파일 2개(`package/package.json` · `package/bin/opencode`)뿐이고, 실행 비트(0755)가
// 이미 서 있다. Windows 것만 이름이 `opencode.exe` 다.
//
//   opencode-darwin-arm64  143MB  package/bin/opencode      (Mach-O arm64)
//   opencode-darwin-x64    148MB  package/bin/opencode
//   opencode-windows-x64   178MB  package/bin/opencode.exe

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 동봉할 버전. **읽는 곳이 여기 하나뿐이라** package.json 에 필드를 늘리지 않는다. */
const VERSION = '1.18.18'
/** 어댑터 하한선 (`desktop/CLAUDE.md`). 이보다 낮으면 이벤트 매핑이 조용히 어긋난다. */
const FLOOR = '1.17.18'

// 타깃 이름은 **electron-builder 의 `${os}-${arch}`** 다 — `mac`/`win` 은 target key 이지
// `process.platform` 이 아니다. 이름이 어긋나면 extraResources 가 빈 자리를 가리킨다.
const TARGETS = {
  'mac-arm64': { pkg: 'opencode-darwin-arm64', bin: 'opencode', platform: 'darwin', arch: 'arm64' },
  'mac-x64': { pkg: 'opencode-darwin-x64', bin: 'opencode', platform: 'darwin', arch: 'x64' },
  'win-x64': { pkg: 'opencode-windows-x64', bin: 'opencode.exe', platform: 'win32', arch: 'x64' },
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vendorDir = (target) => join(root, 'build', 'vendor', 'opencode', target)

/** 이 머신에서 기본으로 받을 타깃 */
function hostTarget() {
  const found = Object.entries(TARGETS).find(
    ([, t]) => t.platform === process.platform && t.arch === process.arch,
  )
  if (found === undefined) fail(`이 판(${process.platform}-${process.arch})용 타깃이 없습니다`)
  return found[0]
}

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

/** `1.18.18` 세 마디 비교. -1·0·1 */
function compareVersion(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0) ? 1 : -1
  }
  return 0
}

async function download(pkg) {
  const meta = await fetch(`https://registry.npmjs.org/${pkg}/${VERSION}`)
  if (!meta.ok) fail(`${pkg}@${VERSION} 메타데이터를 못 받았습니다 (HTTP ${meta.status})`)
  const { dist } = await meta.json()
  const res = await fetch(dist.tarball)
  if (!res.ok) fail(`${dist.tarball} 내려받기 실패 (HTTP ${res.status})`)
  const body = Buffer.from(await res.arrayBuffer())

  // 레지스트리가 준 무결성 값과 대조한다. 반입물에 들어갈 실행 파일이라 **여기서 안 재면
  // 잰 자리가 없다** — 폐쇄망 안에서는 다시 받아 볼 방법도 없다.
  const digest = `sha512-${createHash('sha512').update(body).digest('base64')}`
  if (digest !== dist.integrity) fail(`${pkg} 무결성 불일치\n  기대: ${dist.integrity}\n  실제: ${digest}`)
  return body
}

/** 받은 실행 파일이 정말 그 버전인지 — **이 판에서 돌릴 수 있을 때만** 잰다. */
function verifyVersion(target, path) {
  const t = TARGETS[target]
  if (t.platform !== process.platform || t.arch !== process.arch) {
    console.log(`  · --version 확인 건너뜀 (${t.platform}-${t.arch} 는 이 판에서 못 돈다)`)
    return
  }
  const printed = execFileSync(path, ['--version'], { encoding: 'utf8' }).trim()
  if (printed !== VERSION) fail(`${target}: --version 이 ${printed} 입니다 (기대 ${VERSION})`)
  if (compareVersion(printed, FLOOR) < 0) fail(`${target}: ${printed} 은 어댑터 하한선 ${FLOOR} 미만입니다`)
  console.log(`  · --version ${printed} (하한선 ${FLOOR} 이상)`)
}

async function fetchTarget(target) {
  const t = TARGETS[target]
  const dest = vendorDir(target)
  const path = join(dest, t.bin)
  console.log(`${target}: ${t.pkg}@${VERSION}`)

  const body = await download(t.pkg)
  mkdirSync(dest, { recursive: true })
  const tmp = mkdtempSync(join(tmpdir(), 'opencode-fetch-'))
  try {
    const tgz = join(tmp, 'pkg.tgz')
    writeFileSync(tgz, body)
    // tarball 안은 `package/bin/<bin>` 하나뿐이라 두 마디를 걷어내면 dest 바로 밑에 놓인다.
    execFileSync('tar', ['-xzf', tgz, '-C', dest, '--strip-components', '2', `package/bin/${t.bin}`])
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  // tarball 에 이미 0755 가 서 있지만(실측) 한 번 더 세운다 — 실행 비트가 빠지면
  // 증상이 "opencode 를 못 찾는다" 로 나온다 (`binary.ts` 는 X_OK 로 판정한다).
  chmodSync(path, 0o755)
  console.log(`  · ${path} (${(statSync(path).size / 1e6).toFixed(0)}MB)`)
  verifyVersion(target, path)
}

/** `dist:*` 앞에서 도는 존재 검사. **왜 실패했는지가 문장으로 나오게** 하는 것이 목적이다. */
function check(targets) {
  const missing = targets.filter((target) => !existsSync(join(vendorDir(target), TARGETS[target].bin)))
  if (missing.length > 0) {
    fail(
      `동봉할 opencode 실행 파일이 없습니다: ${missing.join(', ')}\n` +
        `  받으세요: node scripts/fetch-opencode.mjs ${missing.join(' ')}\n` +
        '  (폐쇄망 안에서는 못 받습니다 — 망 밖에서 빌드해 아티팩트를 반입하세요)',
    )
  }
  console.log(`✓ 동봉 준비됨: ${targets.join(', ')}`)
}

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const named = args.filter((a) => !a.startsWith('--'))
const targets = args.includes('--all') ? Object.keys(TARGETS) : named.length > 0 ? named : [hostTarget()]

for (const target of targets) {
  if (TARGETS[target] === undefined) fail(`모르는 타깃: ${target} (있는 것: ${Object.keys(TARGETS).join(', ')})`)
}

if (checkOnly) {
  check(targets)
} else {
  for (const target of targets) await fetchTarget(target)
  console.log(`✓ ${targets.length}개 준비됨 — build/vendor/opencode/`)
}
