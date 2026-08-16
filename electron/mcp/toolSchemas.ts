// 도구 목록 — **모델이 읽는 유일한 설명서다.**
//
// `rpc.ts` 에서 뽑아 왔다 (그 파일이 300줄 상한에 닿았다). 판단은 하나도 안 옮겼고 목록만
// 왔다. 자리를 고르는 근거가 하나 더 있다: 도구가 늘어나는 자리와 프로토콜을 다루는 자리가
// 같은 파일에 있으면, 설명 한 줄 고칠 때마다 JSON-RPC 처리를 함께 읽게 된다.
//
// 설명은 길다. **짧게 쓰면 모델이 안 부르거나 엉뚱하게 부른다** — 무엇을 하는지보다
// **언제 쓰고 언제 쓰지 않는지**, 그리고 **하지 않는 일**을 적는다.

export const TOOLS = [
  {
    name: 'open_file',
    description:
      '이 프로젝트의 파일을 Open Code Desktop 화면에 연다. 사용자가 파일을 눈으로 보고 싶어 할 때 쓴다. 사용자가 다른 프로젝트를 보고 있으면 열지 못하며, 그 사실을 결과로 알려준다.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '프로젝트 루트 기준 상대경로. 절대경로도 받지만 루트 밖이면 거부한다.',
        },
        line: {
          type: 'number',
          description: '열면서 옮겨 갈 줄 번호 (1부터). 없으면 파일 첫머리를 연다.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'open_terminal',
    description:
      'Open Code Desktop 화면 아래 셸 칸을 펴고, 명령을 **채워만 둔다 — 실행하지 않는다.** 사용자가 화면에서 눈으로 확인하고 직접 엔터를 친다. 지우거나 되돌리기 어려운 명령, 사용자가 판단해야 하는 명령을 제안할 때 쓴다. 결과가 곧바로 필요하면 이 도구가 아니라 셸을 직접 실행하는 도구를 쓴다 — 여기서는 아무것도 돌아가지 않는다. 사용자가 다른 프로젝트를 보고 있으면 열지 못하며, 그 사실을 결과로 알려준다.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description:
            '채울 명령 한 줄. 없으면 칸만 편다. **개행을 넣지 마라** — 셸에 들어가는 즉시 실행되어 사용자가 확인할 기회가 사라지므로 거절한다.',
        },
      },
      // command 는 없어도 된다 — "터미널 좀 열어 줘" 만으로도 뜻이 있다
      required: [],
    },
  },
  {
    name: 'run_project',
    description:
      '개발 서버·테스트 감시처럼 **안 끝나는 명령**을 Open Code Desktop 이 붙들고 돌린다. 셸 도구는 명령이 끝나야 출력이 나와서 이런 것을 못 돌린다 — 이 도구는 시작만 하고 곧바로 돌아오며, 출력은 read_logs 로 읽는다. 같은 이름이 이미 돌고 있으면 겹쳐 띄우지 않고 그 사실을 알려준다. **멈추거나 다시 띄우는 기능은 없다** — 사용자가 보고 있던 것을 없애는 일이라 사용자가 직접 탭을 닫아야 한다. 사용자가 다른 프로젝트를 보고 있으면 띄우지 못하며, 그 사실을 결과로 알려준다.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            '이 프로세스를 부를 짧은 이름 (dev · test · build 등). 화면의 탭 이름이 되고, read_logs 로 로그를 물을 때 이 이름을 쓴다. 사용자의 셸 칸 이름(shell…)은 쓸 수 없다.',
        },
        command: {
          type: 'string',
          description:
            '프로젝트 루트에서 돌릴 명령 한 줄 (예: `npm run dev`). **개행을 넣지 마라** — 여러 개를 이어 돌리려면 `&&` 로 한 줄에 쓴다.',
        },
      },
      required: ['name', 'command'],
    },
  },
  {
    name: 'read_logs',
    description:
      'run_project 로 띄워 **지금 돌고 있는** 프로세스가 그동안 뱉은 출력을 읽는다. 셸 도구가 명령을 새로 돌리는 것과 다르다 — 이쪽은 이미 돌고 있는 것을 들여다볼 뿐이라 아무것도 실행하지 않는다. 개발 서버가 떴는지, 방금 고친 파일이 다시 컴파일됐는지, 무슨 오류가 났는지를 볼 때 쓴다. **결과는 반드시 잘려서 오고 전체 줄 수가 함께 온다** — 잘렸으면 tail·level·since 로 좁혀 다시 부른다.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'run_project 로 띄울 때 준 이름.',
        },
        tail: {
          type: 'number',
          description: '마지막 몇 줄을 볼지. 기본 100줄, 최대 1000줄.',
        },
        level: {
          type: 'string',
          description:
            '`error` 면 오류로 보이는 줄만, `warn` 이면 경고까지, `all`(기본)이면 전부. 수천 줄에서 문제만 집을 때 쓴다. 낱말로 짐작하는 것이라 놓치는 줄이 있을 수 있다.',
        },
        since: {
          type: 'number',
          description:
            '여기부터 뒤만 본다. **지난번 답의 마지막 줄에 실린 값을 그대로 주면** 그 뒤에 새로 나온 것만 온다 — 고치고 다시 물을 때 같은 것을 두 번 읽지 않는 길이다.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'save_run_commands',
    description:
      '이 프로젝트를 **어떻게 띄우는지**를 알아낸 뒤 그 목록을 AGENTS.md 의 「실행」 절에 적는다. 사용자가 사이드바 「실행」 패널에서 ▶ 로 누르는 목록이 그것이고, 한 번 적어 두면 다음부터는 모델을 부르지 않고 그 파일에서 읽는다. 사용자가 "실행 방법을 찾아 달라" 고 할 때, 매니페스트가 바뀌어 "다시 확인" 을 청할 때 쓴다. **먼저 프로젝트를 읽어라** — package.json 의 scripts, gradle 태스크, Makefile, docker-compose, README 를 보고 정하고, 규칙으로 짐작하지 마라(모노레포·워크스페이스·`dev` 가 아니라 `start:local` 인 프로젝트가 실제로 있다). 이 도구는 파일에 적기만 하고 **아무것도 실행하지 않는다** — 돌리는 것은 run_project 다. AGENTS.md 를 직접 고치지 말고 이 도구를 써라: 형식이 어긋나면 패널이 그 목록을 못 읽는다.',
    inputSchema: {
      type: 'object',
      properties: {
        commands: {
          type: 'array',
          description:
            '사용자가 고를 만한 실행 방법들 (대개 2~5개). 개발 서버·테스트·빌드처럼 **사람이 누를 것**만 넣는다 — 설치나 한 번 쓰는 명령은 넣지 않는다.',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description:
                  '화면에 뜨는 짧은 이름 (dev 서버 · 테스트 · 빌드). 그대로 탭 이름이 되고 read_logs 가 이 이름을 쓴다. 사용자의 셸 칸 이름(shell…)은 쓸 수 없다.',
              },
              command: {
                type: 'string',
                description:
                  '프로젝트 루트에서 돌릴 명령 한 줄. **개행을 넣지 마라** — 여러 개를 이어 돌리려면 `&&` 로 한 줄에 쓴다. 도커를 먼저 띄워야 하면 그것까지 한 줄에 담는다.',
              },
              note: {
                type: 'string',
                description:
                  '한 줄 설명. 사용자가 무엇을 누르는지 알아야 할 때만 (예: "도커를 먼저 띄웁니다"). 없어도 된다.',
              },
            },
            required: ['name', 'command'],
          },
        },
      },
      required: ['commands'],
    },
  },
] as const
