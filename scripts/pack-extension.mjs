#!/usr/bin/env node
// 확장 폴더를 배포용 패키지(.axcx — 안은 zip)로 묶는다.
//
//   node scripts/pack-extension.mjs <확장폴더> [나갈곳]
//
// 이름·버전은 폴더 안 manifest.json 이 정한다. 파일명은 `{name}-{version}.axcx` 가 된다.
// 배포처에 올릴 때도 서버가 매니페스트를 다시 읽으므로, 파일명은 사람이 알아보기 위한 것이다.
//
// 새 의존성을 넣지 않는다 (에어갭) — 시스템 zip 을 쓴다.
// 압축 안에 폴더를 한 겹 감싸지 않는다: manifest.json 이 최상위에 오게 한다
// (앱이 한 겹은 벗겨주지만, 규격대로 만드는 것이 맞다).

import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'

const [source, outDir = 'dist-extensions'] = process.argv.slice(2)

if (!source) {
  console.error('쓰기: node scripts/pack-extension.mjs <확장폴더> [나갈곳]')
  process.exit(1)
}

const dir = resolve(source)
if (!(await isDirectory(dir))) {
  console.error(`폴더가 아닙니다: ${dir}`)
  process.exit(1)
}

const manifestPath = join(dir, 'manifest.json')
let manifest
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
} catch (error) {
  console.error(`manifest.json 을 읽지 못했습니다: ${error.message}`)
  process.exit(1)
}

const { name, version, main } = manifest
if (!name || !version || !main) {
  console.error('manifest.json 에 name·version·main 이 모두 있어야 합니다')
  process.exit(1)
}
if (manifest.manifestVersion === undefined) {
  console.error('manifest.json 에 manifestVersion 이 없습니다 (표준 v1 필수)')
  process.exit(1)
}
if (!(await isFile(join(dir, main)))) {
  console.error(`main 이 가리키는 파일이 없습니다: ${main}`)
  process.exit(1)
}
if (!String(main).endsWith('.js')) {
  console.error(`main 은 .js 여야 합니다 (Node 가 싣습니다): ${main}`)
  process.exit(1)
}

const out = isAbsolute(outDir) ? outDir : resolve(outDir)
await mkdir(out, { recursive: true })
const target = join(out, `${name}-${version}.axcx`)
await rm(target, { force: true })

// -r 재귀 · -X 확장속성 제외 · 폴더 안에서 실행해 경로가 한 겹 감싸이지 않게 한다
await run('zip', ['-r', '-X', '-q', target, '.', '-x', '.*', '-x', '__MACOSX/*'], dir)

const info = await stat(target)
console.log(`${basename(target)}  (${(info.size / 1024).toFixed(1)} KB)`)
console.log(target)

function run(command, args, cwd) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.on('error', fail)
    child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`${command} 실패 (${code})`))))
  })
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}
