#!/usr/bin/env node
// tree-sitter 문법(wasm)과 그 런타임을 npm 레지스트리에서 받아
// `extensions/code-map/vendor/` 에 놓는다. 「코드 지도」 확장이 이걸 읽는다.
//
// **이 스크립트는 망 밖(개발 머신·CI)에서만 돈다.** 폐쇄망 현장에는 npm 이 없고,
// 확장은 `.axcx`(zip)로 반입되므로 wasm 이 그 안에 실려 들어가야 한다.
// `fetch-opencode.mjs` 와 같은 결이고, 다른 점은 **플랫폼이 없다는 것**이다 —
// wasm 은 어느 판에서나 같은 파일이라 타깃별로 갈리지 않는다.
//
// 받은 것은 **레포에 커밋하지 않는다** (`.gitignore`). 6.7MB 로 opencode 의 137MB 보다
// 훨씬 작지만, 커밋하지 않는 진짜 이유는 크기가 아니라 **출처**다 — 아래 무결성 대조가
// 「이 파일이 정말 그 패키지의 그 버전인가」를 재는 유일한 자리이고, 레포에 넣어 버리면
// 그 뒤로는 아무도 다시 재지 않는다.
//
// 새 언어를 더하려면 PACKAGES 에 줄을 더하고 `core/languages.js` 에 확장자를 잇는다.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VENDOR = join(ROOT, 'extensions', 'code-map', 'vendor')

/**
 * 받을 것. **버전을 여기 한 곳에 박는다** — 문법 버전이 바뀌면 파싱 결과가 바뀌므로
 * 두 곳에 적어 두면 한쪽이 조용히 낡는다.
 *
 * `.tsx` 가 `tree-sitter-typescript` 와 **같은 패키지에 다른 wasm** 으로 들어 있다.
 * 이걸 안 싣고 `.tsx` 를 typescript 문법으로 파싱하면 **예외가 아니라 오류 트리**가 나온다 —
 * 이 워크스페이스 실측으로 243개 중 208개가 그랬다. 조용히 비는 실패라 꼭 함께 받는다.
 */
const PACKAGES = [
  { pkg: 'web-tree-sitter', version: '0.26.8', files: ['web-tree-sitter.cjs', 'web-tree-sitter.wasm', 'LICENSE'] },
  { pkg: 'tree-sitter-typescript', version: '0.23.2', files: ['tree-sitter-typescript.wasm', 'tree-sitter-tsx.wasm', 'LICENSE'] },
  { pkg: '@tree-sitter-grammars/tree-sitter-kotlin', version: '1.1.0', files: ['tree-sitter-kotlin.wasm', 'LICENSE'] },
]

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

/** 받은 파일이 다 있는가. `--check` 와 실제 받기가 같은 판정을 쓰게 한자리에 둔다 */
function missingFiles() {
  return PACKAGES.flatMap((p) => p.files.map((f) => join(dirName(p.pkg), f)))
    .filter((rel) => !existsSync(join(VENDOR, rel)))
}

/** 스코프(`@ns/name`)는 디렉토리 이름에서 마지막 마디만 쓴다 — 중첩을 만들지 않는다 */
function dirName(pkg) {
  return pkg.split('/').pop()
}

async function download({ pkg, version }) {
  const meta = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg).replace('%40', '@')}/${version}`)
  if (!meta.ok) fail(`${pkg}@${version} 메타데이터를 못 받았습니다 (HTTP ${meta.status})`)
  const { dist } = await meta.json()
  const res = await fetch(dist.tarball)
  if (!res.ok) fail(`${dist.tarball} 내려받기 실패 (HTTP ${res.status})`)
  const body = Buffer.from(await res.arrayBuffer())

  // 레지스트리가 준 무결성 값과 대조한다. 폐쇄망으로 반입될 파일이라
  // **여기서 안 재면 잰 자리가 없다** (`fetch-opencode.mjs` 와 같은 이유).
  const digest = `sha512-${createHash('sha512').update(body).digest('base64')}`
  if (digest !== dist.integrity) fail(`${pkg} 무결성 불일치\n  기대: ${dist.integrity}\n  실제: ${digest}`)
  return body
}

async function fetchPackage(entry) {
  const dest = join(VENDOR, dirName(entry.pkg))
  mkdirSync(dest, { recursive: true })
  const tmp = mkdtempSync(join(tmpdir(), 'grammar-fetch-'))
  try {
    const tgz = join(tmp, 'package.tgz')
    writeFileSync(tgz, await download(entry))
    // tarball 안은 전부 `package/` 아래다. 한 마디를 걷어내면 dest 바로 밑에 놓인다.
    execFileSync('tar', ['-xzf', tgz, '-C', dest, '--strip-components', '1', ...entry.files.map((f) => `package/${f}`)])
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  console.log(`  ✓ ${entry.pkg}@${entry.version} — ${entry.files.join(' · ')}`)
}

const check = process.argv.includes('--check')

if (check) {
  const missing = missingFiles()
  if (missing.length > 0) {
    fail(
      `문법 파일이 없습니다 (${missing.length}개):\n` +
        missing.map((m) => `    ${m}`).join('\n') +
        `\n\n  받으세요: node scripts/fetch-grammars.mjs`,
    )
  }
  console.log('문법 파일이 모두 있습니다.')
} else {
  console.log(`문법을 받습니다 → ${VENDOR}`)
  for (const entry of PACKAGES) await fetchPackage(entry)
  console.log('\n완료. 확장을 포장하려면: npm run ext:pack extensions/code-map')
}
