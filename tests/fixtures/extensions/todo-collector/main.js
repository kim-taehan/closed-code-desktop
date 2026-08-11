// TODO 수집기 — 데스크톱 확장 1호.
//
// 목적은 기능이 아니라 **배선 검증**이다. 확장 체계(로더 → 호스트 → API → 화면)가
// 끝까지 뚫렸는지를 이 확장 하나가 증명한다. 그래서 일부러 작다.
//
// 이 파일은 호스트(utilityProcess) 안에서 require() 되어 돈다.
// - electron 을 import 할 수 없다 (자식에는 process.parentPort 만 있다)
// - node 내장 모듈도 쓰지 않는다 — 파일 접근은 전부 davis.* 를 거친다.
//   확장이 fs 를 직접 쓰면 경로 경계(resolveInside)를 우회하게 되고,
//   그러면 API 를 좁게 만든 의미가 사라진다.
//
// 쓰는 API 는 4개뿐이다:
//   davis.workspace.getProjectPath()      현재 프로젝트 경로 (표시용)
//   davis.workspace.listFiles(glob)       훑을 대상 (프로젝트 상대경로 배열)
//   davis.workspace.readFile(relPath)     내용 (경로 탈출은 호스트가 막는다)
//   davis.view.setRows(viewId, rows)      결과를 앱 화면에 넘김

'use strict'

/** 훑을 대상. 소스만 본다 — 빌드 산출물·의존성을 넣으면 결과가 잡음으로 덮인다. */
const GLOB = '**/*.{ts,tsx,js,jsx,py,java,kt,go,rs,rb,c,h,cpp,cs,swift,sh,md}'

/** 한 파일에서 뽑을 최대 건수. 생성 파일 하나가 표 전체를 덮는 것을 막는다. */
const MAX_PER_FILE = 200

/**
 * 주석 표시자. 단어 경계를 요구해 `TODOS`·`fixmeLater` 같은 식별자에 걸리지 않게 한다.
 * 뒤의 `[:\s]` 는 `TODO:` 와 `TODO ` 를 함께 받되 `TODO` 로 끝나는 줄은 버린다는 뜻이다.
 */
const MARKER = /\b(TODO|FIXME|HACK|XXX)\b[:\s]/

/** 확장 진입점. 호스트가 활성화 시 davis 를 넘겨준다. */
function activate(davis) {
  return {
    commands: {
      'todoCollector.scan': () => scan(davis),
    },
  }
}

async function scan(davis) {
  const root = await davis.workspace.getProjectPath()
  const files = await davis.workspace.listFiles(GLOB)

  const rows = []
  for (const file of files) {
    // 한 파일이 못 읽혀도 전체를 버리지 않는다 — 읽을 수 있는 것까지는 보여준다.
    let text
    try {
      text = await davis.workspace.readFile(file)
    } catch {
      continue
    }
    rows.push(...collect(file, text))
  }

  // 표시자 종류 → 파일 → 줄 순. 종류를 먼저 두는 건 FIXME 가 TODO 보다 급하기 때문이다.
  rows.sort(
    (a, b) =>
      rank(a.kind) - rank(b.kind) || a.file.localeCompare(b.file) || a.line - b.line,
  )

  await davis.view.setRows('todoCollector.results', rows)
  return { root, fileCount: files.length, rowCount: rows.length }
}

/** 한 파일의 본문에서 표시자 줄을 뽑는다. */
function collect(file, text) {
  const rows = []
  const lines = text.split('\n')

  for (let i = 0; i < lines.length && rows.length < MAX_PER_FILE; i += 1) {
    const line = lines[i]
    const hit = MARKER.exec(line)
    if (!hit) continue

    rows.push({
      kind: hit[1],
      file,
      // 사람이 보는 줄 번호는 1부터다. 화면에서 파일을 열 때도 이 값을 그대로 쓴다.
      line: i + 1,
      text: line.slice(hit.index + hit[0].length).trim(),
    })
  }

  return rows
}

function rank(kind) {
  switch (kind) {
    case 'FIXME':
      return 0
    case 'XXX':
      return 1
    case 'HACK':
      return 2
    default:
      return 3
  }
}

module.exports = { activate }
