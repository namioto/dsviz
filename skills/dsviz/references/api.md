# createDiagram API

```js
Dsviz.createDiagram("#id", {
  caption: "결론 한 문장",          // figcaption, 고정
  alt: "스크린리더용 설명",          // 생략 시 caption
  width: 640,                       // 기준 폭 (기본 640)
  draw(g) { ... },                  // 640 기준 좌표로 요소 배치
  mobile: { width: 360, draw(g) { ... } }, // 선택. 실제 폭 480 미만에서 사용
  sequence: [ ... ],                // 선택. 없으면 정적 그림
  timing: { play: 3000, hold: 3000 }, // 기본값 (hold: 다 그려진 그림을 보여주는 시간)
  height: 240,                      // 선택. 생략 시 요소가 차지한 위아래 범위 + 여백 8씩으로 자동 계산
});
```

- 좌표는 기준 폭 단위. 실제 폭에 맞춰 비율을 곱하고, 글자는 실제 10px 미만으로 줄지 않는다
- 기준 폭 360으로 줄어들면 글자가 상대적으로 커지므로, 요소가 빽빽한 그림은 `mobile`을 따로 쓴다
- 위쪽 빈 공간은 자동으로 잘림. 첫 요소를 y=30에 두든 y=0에 두든 결과 같음
- 요소 정의 순서와 무관하게 `arrow`의 `from`/`to`, `status`의 `at`은 draw가 끝난 뒤 연결
- 그리는 순서 = 겹치는 순서 (나중 요소가 위)

## createDemo (단계별 캡션)

```js
Dsviz.createDemo("#id", {
  steps: [
    { at: 0, caption: "두 서버에 요청이 40건씩 들어온다" },
    { at: 0.38, caption: "평균 응답 시간은 둘 다 120ms다" },
    { at: 0.68, caption: "가장 느린 1%는 약 6배 차이다" },
  ],
  draw(g) { ... },        // createDiagram과 같음
  sequence: [ ... ],      // createDiagram과 같음 (진행률 0~1은 전체 재생 기준)
  timing: { play: 2600 * 단계 수, hold: 3000 }, // 기본값
});
```

- 진행률이 `at`을 지나면 캡션이 바뀜. 캡션 위 점이 현재 단계를 표시하고, 캡션 칸 높이는 가장 긴 캡션 기준으로 고정
- `caption` 대신 `steps`를 씀. 정지 화면(reduced-motion/인쇄/화면 밖)은 마지막 단계 캡션
- 단계 시작(`at`)은 그 단계 첫 효과보다 0.02~0.05 앞에 둠(캡션이 먼저 바뀌고 그림이 따라옴)
- 검사: 단계 2개 미만, 첫 `at`이 0이 아님, `at` 순서, 캡션 없음, 단계 구간 안에서 시작하는 효과가 없음
- WebP 내보내기에서도 단계별 캡션이 그대로 바뀜
- `display: "split"`: 단계마다 그림(카드)을 하나씩 세로로 놓음. 각 그림은 앞 단계까지 완성된 상태에서 그 단계 효과만 반복 재생하고, 캡션은 그 단계 것으로 고정. 카드 높이는 모든 단계에서 같음(나중 단계 요소 자리만큼 비어 있음). 이름은 `<id>-1`, `<id>-2` 순이라 검사와 내보내기도 단계마다 하나씩 나옴

## motion (createDiagram, createDemo)

- 생략 또는 `"full"`: 대본 그대로
- `"soft"`(약하게): 모든 요소가 처음부터 보이고 같은 `sequence`를 가벼운 움직임으로 바꿔 반복. `highlight` 대상은 역할 색과 회색을 부드럽게 오감, 기준선(`refLine`)은 나타났다 사라졌다, 화살표/선은 점이 한 번 지나감, 칩/`status`/`pulse` 대상은 고리 한 번. 데이터(막대/시리즈/점)와 상자의 등장 효과는 버림. 멈춤(`hold`) 기본 0. `createDemo`는 캐러셀 없이 마지막 단계 캡션 하나
- `"off"`(끄기): 완성 그림만. `createDemo`는 마지막 단계 캡션 하나
- 움직일 요소가 없는 그림은 약하게도 끄기와 같게 보임

## createLab (독자가 조작하는 실험)

```js
Dsviz.createLab("#id", {
  caption: "결론 한 문장 (시뮬레이션)",
  hint: "계산대 수를 바꾸고 실행해 보세요",
  controls: [
    { type: "toggle", id: "counters", label: "계산대 수", options: [[1, "1곳"], [2, "2곳"]], value: 1 },
    { type: "slider", id: "rate", label: "손님 도착", min: 20, max: 50, step: 5, value: 35, format: (v) => `분당 ${v}명` },
    { type: "action", id: "rush", label: "손님 몰리기", onClick(sim, ctl) { sim.queue += 10; } },
    { type: "run" },                 // 실행/멈춤 (labels: ["시작", "멈춤"]로 바꿀 수 있음)
    { type: "reset" },               // 처음으로
  ],
  metrics: [{ id: "waiting", label: "기다리는 손님", format: (v) => `${v}명` }],
  init(ctl) { return { rand: Dsviz.rng(3), queue: 0 }; },   // 시뮬레이션 상태 만들기
  step(sim, dt, ctl) { ... },        // dt(ms)만큼 진행, sim을 직접 바꿈
  measure(sim, ctl) { return { waiting: sim.queue }; },     // metrics 값
  draw(g, sim, ctl) { ... },         // 매 프레임 현재 상태로 그림 (요소/차트 API 동일)
  pointer: true,                     // 선택: ctl.pointer = { x, y, inside } (그림 좌표)
  autoplay: false,                   // 기본: 실행 버튼을 눌러야 시작
  exportMs: 6000,                    // 캡처/내보내기에서 시뮬레이션할 시간
});
```

- toggle을 바꾸면 `init`부터 다시 시작(실행 상태는 유지), slider는 진행 중인 시뮬레이션에 바로 반영
- 조작 요소는 캔버스 위 한 줄, 지표는 캔버스 아래. 키보드로 조작 가능
- 난수는 `Dsviz.rng(seed)`만 사용(`Math.random` 금지). 캡처와 내보내기는 처음부터 고정 간격(1/30초)으로 `exportMs`까지 진행한 결과라 매번 같음
- `?t=0.5`는 `exportMs`의 절반 시점. 검사는 이 시점 그림 기준이라, 토글 값마다 겹침을 보려면 기본값을 바꿔 한 번씩 캡처
- 카드 높이는 첫 프레임 기준으로 고정되고 커질 때만 늘어남. 요소 수가 크게 변하면 `height`를 지정
- 모바일 배치: createDiagram과 같은 `mobile: { width: 360, draw(g, sim, ctl) { ... } }`
- 내보내기와 캡처는 기본 조작값 한 가지로만 나옴. A/B 토글의 한쪽만으로 결론이 보이지 않으면 두 방식을 한 화면에 나란히 그리고(토글 대신 슬라이더로 기준값만 바꾸게), 기본값은 결론이 보이는 쪽으로 둠
- 시뮬레이션은 현실 속도가 아니어도 됨. 배속을 쓰면 지표와 캡션의 단위는 시뮬레이션 시간 기준으로 맞추고 캡션에 "(시뮬레이션)"을 붙임
- 실제 현상(메인 스레드 막기 등)을 일으키는 `action`은 한 번에 2초 이하

## 요소 (모두 첫 인자가 고유 id)

| 메서드 | 좌표 기준 | 주요 옵션 | 용도 |
|---|---|---|---|
| `g.box(id, o)` | `x y` = 왼쪽 위 | `w h label sub role fill dashed labelAt size subSize radius` | 구성 요소. `sub`: 라벨 아래 작은 회색 둘째 줄. `fill`: `soft`(기본) `solid` `none`. `dashed`: 테두리 점선. `labelAt`: `center`(기본) `top`(안에 다른 요소를 담을 때, 라벨이 박스 위 끝에서 12 아래) |
| `g.chip(id, o)` | `x y` = 중심 (`align: "left"`면 왼쪽 끝, `"right"`면 오른쪽 끝) | `text role align size` | 알약 배지. 단계 이름, 상태, 태그 |
| `g.text(id, o)` | `x y` = 글자 덩어리의 세로 중앙, 가로는 `align` 기준 | `text size weight align maxWidth role tone mono` | 자유 글자. `align`: `center`(기본) `left` `right`. `tone`: `ink` `ink2`(기본) `ink3`. `maxWidth`를 주면 줄바꿈 |
| `g.arrow(id, o)` | 요소 id면 테두리에서 시작/끝 | `from to via offset role dashed label labelSide heads width gap` | 연결선. `from`/`to`는 요소 id 또는 `[x, y]`. `offset`: 진행 방향에 수직으로 평행 이동(왕복 화살표 두 개를 나란히 둘 때 같은 값). `via`: 꺾이는 점 목록. `heads`: `end`(기본) `start` `both` `none` |
| `g.line(id, o)` | `points` = 점 목록 | `role dashed label labelSide width heads` | 기준선, 구분선, 경로. `heads` 기본 `none` |
| `g.loop(id, o)` | `cx cy` = 원 중심 | `r role label startDeg gapDeg` | 순환 경로(시계 방향). `label`은 원 중심 |
| `g.dot(id, o)` | `x y` = 중심 | `r role` | 점, 위치 표시 |
| `g.status(id, o)` | `at`(박스 아래 가운데) 또는 `x y` = 중심 | `text role` | 진행 중 표시. `role` 기본 `warn` |
| `g.person(id, o)` | `x y` = 그림 중심 | `size count role label labelSize` | 사람(사용자, 고객, 담당자). `size`: 그림 높이(기본 40). `count`: 여러 명을 겹쳐 그림(사용자들, 고객 무리), 5 이하. 실제 인원수는 `label`에 적음. `label`은 그림 아래. 화살표는 그림 테두리에 붙음 |
| `g.people(id, o)` | `x y` = 왼쪽 위 | `total cols size gap mark role label labelSize` | 사람 아이콘 격자(단위 차트). 인원 중 일부가 결론일 때(N명 중 M명). 앞에서부터 `mark`개를 `role` 색, 나머지는 회색. `highlight`를 주면 표시한 사람만 회색에서 역할 색으로 바뀜. 100개를 넘기면 아이콘 하나의 단위를 바꾸고 `label`에 적음(`아이콘 1개 = 10명`) |
| `g.table(id, o)` | `x y` = 왼쪽 위 | `columns rows header rowH headH size` | 표. `columns`: `{ label sub w role }` 목록(`sub`는 타입처럼 머리글 둘째 줄). `rows`: 칸 값 배열, 또는 행 전체에 적용할 `{ cells, role, dashed }`. 칸 값에 `{ text role dashed }`를 주면 그 칸만. 역할 색은 칸 > 행 > 열 순으로 적용. `header: false`면 머리글 없이 행만. 머리글 높이는 글자에 맞춰 자동. 반환값 `{ x y w h }`로 표 아래/옆 요소 위치를 계산 |

- `role`: `focus` `compare` `alert` `warn` `accent` `muted`. box는 생략 시 회색 틀, arrow/line은 `muted`, chip/dot/loop는 `focus`
- `labelSide`: `above`(기본) `below`. 수평선은 위/아래, 세로선은 `above`가 오른쪽, 대각선은 위쪽 방향이 `above`. 대각선이 나란히 있으면 생략(기본값)이 가장 안전
- 표 칸 id: 머리글 `표id.h0`, 데이터 `표id.r0c1`(0부터). arrow 연결과 sequence 대상으로 씀. sequence에는 묶음 id도 씀: `표id`(전체) `표id.h`(머리글) `표id.r0`(행) `표id.c1`(열, 머리글 포함). 묶음에 `highlight`를 주면 역할 색 있는 칸만 바뀜

## 차트

```js
g.chart("c", { x: 48, y: 30, w: 520, h: 170, yLabel: "손님 수(명)" });
g.lineSeries("weekend", { chart: "c", label: "주말", role: "focus", dots: true, data: [["9시", 12], ["11시", 34]] });
g.bars("b", { chart: "c", labels: true, format: (v) => `${v}분`, roles: ["muted", "alert"], data: [["주문", 1.5], ["계산", 6.2]] });
g.refLine("avg", { chart: "c", y: 26, label: "기준 26도", role: "alert" });
g.chip("peak", { chart: "c", x: "15시", y: 82, dy: -20, text: "정점 82명" });
```

| 메서드 | 주요 옵션 | 설명 |
|---|---|---|
| `g.chart(id, o)` | `x y w h xDomain yDomain xTicks yTicks xLabel yLabel xFormat yFormat grid` | 축과 눈금. x y w h는 그림 영역(눈금 글자는 바깥). x 값이 문자열이면 범주형(데이터 순서대로), 숫자면 선형. `yDomain` 생략 시 0을 포함해 데이터에 맞춰 자동. `xFormat`/`yFormat`: 눈금 글자 함수(기본 `1.2k` 형식). `xTicks` 기본 5, `yTicks` 기본 4 |
| `g.lineSeries(id, o)` | `chart data role label labelDy dots dashed width curve` | 선. `data`: `[[x, y], ...]`. `label`은 선 끝 오른쪽에 붙음. `dots`: 데이터 점 표시. `curve: "smooth"`: 단조 보간 곡선(점 사이에서 양옆 데이터 값을 넘지 않음). 기본 `"linear"` |
| `g.areaSeries(id, o)` | lineSeries와 같음 | 선 아래를 연하게 채움 |
| `g.bars(id, o)` | `chart data role roles labels format binWidth` | 막대. 막대마다 요소가 생기고 id는 `<id>-0`, `<id>-1` ... (sequence와 arrow에서 사용). `roles`: 막대별 역할 색. `labels`: 막대 위에 값 표시, `format`으로 글자 지정. x가 숫자면 히스토그램: 키는 구간 가운데값, `binWidth`는 구간 폭(생략 시 키 간격) |
| `g.groupedBars(id, o)` | `chart series labels format` | 묶은 막대. `series`: `[{ id, label, role, data: [[범주, 값], ...] }]`. 막대 id는 `<id>-<시리즈 id>-<i>`. 범례 자동 |
| `g.stackedBars(id, o)` | `chart series format` | 쌓은 막대. series 형식은 groupedBars와 같고, 첫 시리즈가 맨 아래. 조각 사이 2px, 맨 위 조각만 둥근 모서리. 범례 자동 |
| `g.scatter(id, o)` | `chart data role r label` | 산점도. `data`: `[[x, y], ...]`. `grow`면 x 순서대로 점이 나타남. `label`이 있으면 범례에 추가 |
| `g.segment(id, o)` | `series from to role width label` | 시리즈 일부 구간(`from`~`to`, 데이터 x 값)을 굵게 덧그려 강조. 시리즈를 둘로 나누지 않고 일부만 강조할 때 사용 |
| `g.refLine(id, o)` | `chart y` 또는 `x`, `label labelAt labelSide role dashed` | 기준선(기본 점선). 가로선 `labelAt`: `end`(기본, 오른쪽 끝) `start` `middle`. 세로선 라벨은 위 끝, `labelSide: "left"`면 선 왼쪽(세로선 두 개가 가까울 때 하나는 왼쪽). 범주형 x축에서 `x`는 범주 가운데에만 놓이므로, 구간 경계나 소수 위치가 필요하면 숫자형 x(히스토그램)로 그린다 |

- `chip` `text` `dot` `status`에 `chart`를 주면 `x` `y`는 데이터 값이고, `dx` `dy`로 그 지점에서 띄움. 칩을 점 왼쪽에 붙이려면 `align: "right"` + `dx: -10`, 오른쪽은 `align: "left"` + `dx: 10`. `dx` `dy`는 기준 폭 단위라 모바일(360)에서는 글자가 상대적으로 커지므로 점에서 24 이상 띄움
- 눈금 글자 함수가 빈 문자열을 돌려주면 그 눈금은 그리지 않음. 바닥 y 눈금이 x 첫 눈금과 모서리에서 겹치면 런타임이 y 눈금을 뺌
- 검사 메시지의 눈금 이름은 `<차트 id>:y눈금(0)`, `<차트 id>:x축 제목(시각)`처럼 종류와 글자로 표시
- 히스토그램 x 눈금은 구간 가운데값이 아니라 축 값이다. 구간 뜻이 필요하면 `xLabel`에 단위를, 막대 칩에 범위를 적는다
- 등장 효과: lineSeries/areaSeries/segment `grow`는 x축을 따라 왼쪽에서 오른쪽으로 일정한 속도로 그려짐(급등 구간이 있어도 같음), refLine `grow`는 선 길이 기준, bars `grow`는 바닥에서 자람, chart는 `fade`
- 그림 안 숫자(막대 값, 칩 글자)는 데이터에서 계산한 값만 쓴다
- 범례: groupedBars/stackedBars와 `label` 있는 scatter는 그림 영역 위 오른쪽에 자동으로 붙음. 선 시리즈는 범례 대신 끝 라벨
- 호버 툴팁(모든 진입점 기본): 막대와 산점도 점은 그 값, 선/영역 차트는 세로 기준선과 같은 x의 모든 시리즈 값. 값 글자는 `yFormat`/`xFormat`(막대는 `format`)을 따름. 끄려면 옵션 `hover: false`. 내보낸 WebP에는 나오지 않음

## sequence

```js
{ id: "req", effect: "grow", from: 0, to: 0.35 }
```

- `from`/`to`: 0~1 진행률. 구간끼리 겹쳐도 됨(앞 단계가 끝나기 전에 다음 단계 시작)
- 한 id에 여러 항목 가능 (예: `grow` 후 `pulse`)
- 여러 요소를 시차 두고 같은 효과: `{ ids: ["d1", "d2", "d3"], effect: "fade", from: 0.3, to: 0.4, stagger: 0.05 }` → d1 0.3~0.4, d2 0.35~0.45, d3 0.4~0.5
- 등장 효과(`grow` `fade` `status`)가 있는 요소는 그 시작 전까지 숨김. 없는 요소는 처음부터 보임

| effect | 종류 | 대상 | 동작 |
|---|---|---|---|
| `grow` | 등장 | 모든 요소 | arrow/line/loop는 선이 자라남, 그 외는 서서히 나타나며 살짝 커짐 |
| `fade` | 등장 | 모든 요소 | 서서히 나타남 |
| `status` | 등장 | status | 나타난 뒤 구간 안에서 점(.) 개수가 바뀜 |
| `travel` | 덧그림 | arrow/line/loop | 점이 경로를 한 번 따라감. `token: "글자"`면 글자 상자가 이동 |
| `cycle` | 덧그림 | arrow/line/loop | 점이 경로를 반복해서 돎. `laps`(기본 2) |
| `pulse` | 덧그림 | box/chip/dot/text/person | 테두리 고리가 퍼지며 사라짐 (선택/충족 강조) |
| `highlight` | 색 전환 | `role`이 있는 모든 요소 | 구간 전에는 회색(box는 회색 틀, 그 외 `muted`), 구간 동안 역할 색으로 바뀜. 선택된 후보나 원인처럼 "나중에 드러나야 하는" 강조에 사용 |

`travel` `cycle` `pulse`는 구간 안에서만 그리고 마지막 프레임에는 그리지 않는다. `highlight`는 등장 효과와 함께 쓸 수 있고, 마지막 프레임에서는 역할 색으로 보인다.

## 검증 신호

- 페이지 URL에 `?t=0.5`를 붙이면 모든 다이어그램이 진행률 0.5에 정지
- `window.__dsvizReport`: 다이어그램별 `{ name, height, issues }`. `capture.mjs`가 이 값을 읽어 PASS/FAIL 출력
- 검사 항목: 중복/누락 id, 없는 연결 대상, sequence의 없는 id/잘못된 effect/구간, 글자 겹침, 가로 넘침, 박스 높이보다 긴 글자, 선이 글자를 가로지르거나 3 이내로 닿음(선보다 나중에 그린 chip은 제외), 화살표 도착 때 대상이 절반도 안 보임, 자유 글자(text/status/chip/선 라벨)가 상자 테두리에 걸침(상자 안쪽에 완전히 들어가면 정상), 글자가 상자 라벨을 가림, 역할 색 없는 요소에 `highlight`, 차트 눈금 글자 겹침, 시리즈 2개 이상인데 라벨 없음, 데이터가 지정한 y 범위 밖, 없는 범주/차트 참조, 칩/라벨이 데이터 시리즈 선을 가림(나중에 그린 칩도 포함), 글자가 막대를 가림, 점(dot)이 글자나 상자 라벨을 가림
- 검사하지 않는 것: 선과 도형의 겹침, 요소 사이 간격, 의미상 어색한 배치. 캡처 이미지로 확인
