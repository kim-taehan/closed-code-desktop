#!/usr/bin/env node
// 확장 배포처 — 임시 로컬 서버.
//
// 목적은 **배포처 프로토콜을 실제로 굴려 보는 것**이다. 앱이 조회할 `index.json` 의 모양을
// 여기서 먼저 고정하고, 화면·배선을 상상이 아니라 실물에 맞춘다.
//
// 의존성을 넣지 않는다 (에어갭). Node 내장 http/fs 만 쓰고, 압축 안의 manifest.json 을
// 읽을 때만 시스템 tar/unzip 을 부른다 — 앱의 `electron/runtime/archive.ts` 와 같은 방식이다.
//
// ponytail: 인증이 없고 업로드 크기 제한이 느슨하다. 사내망 임시용이라 그렇게 뒀다.
// 실제 배포처가 되면 Admin 서버(`deployments`)에 붙이는 것이 맞다.

import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const STORE = join(HERE, 'store')
const PUBLIC = join(HERE, 'public')
const PORT = Number(process.env.PORT ?? 4321)

/** 패키지 파일 하나가 담기는 곳: store/{name}/{version}.axcx */
const packagePath = (name, version) => join(STORE, name, `${version}.axcx`)

// ─────────────────────────── 배포처 목록 ───────────────────────────

/**
 * 앱이 조회하는 것. **이 모양이 배포처 프로토콜이다.**
 *
 * `url` 은 이 문서 기준 상대경로다 — 폴더째 옮겨도 링크가 안 깨진다(에어갭에서 중요).
 */
async function buildIndex() {
  const extensions = []
  for (const name of await listDirs(STORE)) {
    const versions = []
    for (const file of await listFiles(join(STORE, name))) {
      if (!file.endsWith('.axcx')) continue
      const version = file.slice(0, -'.axcx'.length)
      const path = join(STORE, name, file)
      const info = await stat(path)
      const manifest = await readManifestFromPackage(path)
      const base = `packages/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
      // 패키지 안에 README 가 있을 때만 주소를 낸다. 없는 주소를 실어 두면 앱이
      // 받아 보고서야 없다는 것을 안다 — 목록이 이미 아는 것을 숨길 이유가 없다.
      const readme = await readReadmeFromPackage(path)
      versions.push({
        version,
        url: base,
        size: info.size,
        uploadedAt: info.mtime.toISOString(),
        ...(readme !== null ? { readme: `${base}/readme` } : {}),
        ...(manifest?.displayName ? { displayName: manifest.displayName } : {}),
        ...(manifest?.description ? { description: manifest.description } : {}),
      })
    }
    if (versions.length === 0) continue
    versions.sort((a, b) => compareVersion(b.version, a.version))
    const newest = versions[0]
    extensions.push({
      name,
      displayName: newest.displayName ?? name,
      ...(newest.description ? { description: newest.description } : {}),
      latest: newest.version,
      versions,
    })
  }
  extensions.sort((a, b) => a.name.localeCompare(b.name))
  return { registryVersion: 1, name: '로컬 임시 배포처', extensions }
}

/** semver 를 숫자로 비교한다. 정식 semver 규칙(프리릴리스 등)은 아직 안 본다. */
function compareVersion(a, b) {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

// ─────────────────────────── 패키지 읽기 ───────────────────────────

/** 압축을 풀지 않고 파일 하나만 꺼내 읽는다. 없거나 못 읽으면 null — 목록이 죽지 않게. */
async function readFromPackage(path, entry) {
  for (const [cmd, args] of [
    ['tar', ['-xOf', path, entry]],
    ['unzip', ['-p', path, entry]],
  ]) {
    try {
      return await capture(cmd, args)
    } catch {
      // 다음 도구로
    }
  }
  return null
}

async function readManifestFromPackage(path) {
  const text = await readFromPackage(path, 'manifest.json')
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * 받기 전에 보여줄 설명. **패키지 안 `README.md` 가 정본이다** — 배포처가 따로 적어
 * 두면 패키지와 어긋난다.
 *
 * ponytail: 목록을 만들 때마다 패키지마다 tar 를 한 번 더 부른다. 사내망 임시 서버라
 * 그냥 뒀다. 패키지가 수백 개가 되면 mtime 기준 메모리 캐시로.
 */
async function readReadmeFromPackage(path) {
  const text = await readFromPackage(path, 'README.md')
  // 빈 README 는 없는 것과 같다 — 눌러도 빈 화면이 나올 주소를 실어 주지 않는다
  return text !== null && text.trim() !== '' ? text : null
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    child.stdout.on('data', (chunk) => {
      out += chunk.toString('utf8')
    })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`${command} ${code}`))))
  })
}

// ─────────────────────────── 서버 ───────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const path = decodeURIComponent(url.pathname)

  try {
    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      return await sendFile(res, join(PUBLIC, 'index.html'), 'text/html; charset=utf-8')
    }
    if (req.method === 'GET' && path === '/index.json') {
      return sendJson(res, 200, await buildIndex())
    }
    if (req.method === 'POST' && path === '/upload') {
      return await handleUpload(req, res)
    }
    if (req.method === 'GET' && path.startsWith('/packages/')) {
      // `/packages/{이름}/{버전}/readme` — 받기 전에 볼 설명. 패키지 안에서 꺼내 준다
      return path.split('/')[4] === 'readme'
        ? await handleReadme(res, path)
        : await handleDownload(res, path)
    }
    if (req.method === 'DELETE' && path.startsWith('/packages/')) {
      return await handleDelete(res, path)
    }
    sendJson(res, 404, { error: '없는 주소입니다' })
  } catch (error) {
    sendJson(res, 500, { error: String(error?.message ?? error) })
  }
})

/** 업로드 — 본문이 곧 패키지 바이트다. 이름·버전은 **패키지 안 매니페스트가 정한다.** */
async function handleUpload(req, res) {
  const body = await readBody(req)
  if (body.length === 0) return sendJson(res, 400, { error: '빈 파일입니다' })

  const temp = join(STORE, `.upload-${Date.now()}.axcx`)
  await mkdir(STORE, { recursive: true })
  await writeFile(temp, body)

  const manifest = await readManifestFromPackage(temp)
  if (!manifest) {
    await rm(temp, { force: true })
    return sendJson(res, 400, { error: '패키지 안에서 manifest.json 을 찾지 못했습니다' })
  }
  const { name, version } = manifest
  if (typeof name !== 'string' || typeof version !== 'string' || !name || !version) {
    await rm(temp, { force: true })
    return sendJson(res, 400, { error: 'manifest.json 에 name·version 이 없습니다' })
  }
  // 이름이 경로로 새지 않게 — 앱의 UNSAFE_NAME 과 같은 규칙
  if (/[/\\]|\.\./.test(name) || /[/\\]|\.\./.test(version)) {
    await rm(temp, { force: true })
    return sendJson(res, 400, { error: 'name·version 에 경로 문자를 쓸 수 없습니다' })
  }

  const dest = packagePath(name, version)
  const replaced = await exists(dest)
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, body)
  await rm(temp, { force: true })

  sendJson(res, 200, { ok: true, name, version, replaced })
}

async function handleDownload(res, path) {
  const [, , name, version] = path.split('/')
  const file = packagePath(name ?? '', version ?? '')
  if (!(await exists(file))) return sendJson(res, 404, { error: '그 버전이 없습니다' })
  res.writeHead(200, {
    'content-type': 'application/zip',
    'content-disposition': `attachment; filename="${name}-${version}.axcx"`,
  })
  createReadStream(file).pipe(res)
}

/**
 * 패키지 안 README.md 를 그대로 준다.
 *
 * 따로 저장해 두지 않는다 — 저장하면 패키지를 덮어썼을 때 설명만 옛것으로 남는다.
 * 정본은 언제나 패키지 안이다.
 */
async function handleReadme(res, path) {
  const [, , name, version] = path.split('/')
  const file = packagePath(name ?? '', version ?? '')
  if (!(await exists(file))) return sendJson(res, 404, { error: '그 버전이 없습니다' })

  const text = await readReadmeFromPackage(file)
  if (text === null) return sendJson(res, 404, { error: '이 패키지에 README.md 가 없습니다' })

  res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' })
  res.end(text)
}

async function handleDelete(res, path) {
  const [, , name, version] = path.split('/')
  const file = packagePath(name ?? '', version ?? '')
  if (!(await exists(file))) return sendJson(res, 404, { error: '그 버전이 없습니다' })
  await rm(file, { force: true })
  // 마지막 버전이었으면 폴더도 치운다 — 빈 폴더가 목록에 남지 않게
  if ((await listFiles(join(STORE, name))).length === 0) {
    await rm(join(STORE, name), { recursive: true, force: true })
  }
  sendJson(res, 200, { ok: true })
}

// ─────────────────────────── 잡동사니 ───────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function sendJson(res, code, data) {
  const body = JSON.stringify(data, null, 2)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

async function sendFile(res, path, type) {
  res.writeHead(200, { 'content-type': type })
  res.end(await readFile(path))
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function listDirs(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name)
  } catch {
    return []
  }
}

async function listFiles(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name)
  } catch {
    return []
  }
}

await mkdir(STORE, { recursive: true })
server.listen(PORT, () => {
  console.log(`확장 배포처: http://localhost:${PORT}`)
  console.log(`목록(앱이 조회할 주소): http://localhost:${PORT}/index.json`)
  console.log(`저장 위치: ${STORE}`)
})
