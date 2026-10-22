/* dsviz runtime: createDiagram
 * file:// 에서도 동작하도록 ES module 대신 전역 Dsviz 노출 */
(function (global) {
  "use strict";

  const FONT =
    "'Pretendard Variable', Pretendard, 'Noto Sans KR', -apple-system, BlinkMacSystemFont, sans-serif";
  const MONO = "'Source Code Pro', ui-monospace, SFMono-Regular, Menlo, monospace";
  const ROLES = ["focus", "compare", "alert", "warn", "accent"];
  const REVEAL = new Set(["grow", "fade", "status"]);
  const OVERLAY = new Set(["travel", "pulse", "cycle"]);
  const TINT = new Set(["highlight"]);
  const MIN_FONT_PX = 10;
  // 다 그려진 그림을 보여주는 시간: 너무 짧으면 읽기 전에 다시 시작함
  const HOLD_MS = 3000;
  const PERSON_MAX = 5;
  const MOBILE_BREAKPOINT = 480;

  // ?t=0.5 → 모든 다이어그램을 진행률 0.5에 고정 (캡처/검증용)
  const FROZEN_T = (() => {
    const v = new URLSearchParams(global.location ? global.location.search : "").get("t");
    return v == null ? null : Math.min(1, Math.max(0, parseFloat(v)));
  })();

  const reports = [];
  global.__dsvizReport = reports;

  // 내보내기용: 모든 다이어그램을 경과 시간 ms 시점으로 그림 (?t= 로 자동 재생을 멈춘 상태에서 사용)
  const controllers = [];
  global.__dsvizSeek = (ms) => {
    for (const c of controllers) c.seek(ms);
  };
  global.__dsvizCycles = () => controllers.map((c) => ({ name: c.name, cycle: c.cycle, animated: c.animated, play: c.play, hold: c.hold }));

  // ---------- 수학/경로 ----------
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function pathLength(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return L;
  }

  // 경로의 앞 frac 비율만큼 잘라낸 점 목록
  function slicePath(pts, frac) {
    const total = pathLength(pts);
    let remain = total * clamp(frac, 0, 1);
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const seg = Math.hypot(x1 - x0, y1 - y0);
      if (remain >= seg) {
        out.push(pts[i]);
        remain -= seg;
      } else {
        const r = seg === 0 ? 0 : remain / seg;
        out.push([x0 + (x1 - x0) * r, y0 + (y1 - y0) * r]);
        break;
      }
    }
    return out;
  }

  const pointAt = (pts, frac) => slicePath(pts, frac).slice(-1)[0];

  // 데이터 시리즈용: 길이가 아니라 x 진행 비율로 자름 (급등 구간이 있어도 왼쪽→오른쪽 속도 일정)
  function slicePathX(pts, frac) {
    const x0 = pts[0][0];
    const target = x0 + (pts[pts.length - 1][0] - x0) * clamp(frac, 0, 1);
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      if (bx <= target) {
        out.push(pts[i]);
        continue;
      }
      const r = bx === ax ? 0 : (target - ax) / (bx - ax);
      out.push([target, ay + (by - ay) * r]);
      break;
    }
    return out;
  }

  // 단조 3차 보간(Fritsch-Carlson): 점 사이 곡선이 양옆 데이터 값을 넘지 않아 없는 봉우리가 생기지 않음
  function monotonePath(pts, per = 12) {
    const n = pts.length;
    if (n < 3) return pts;
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    for (let i = 1; i < n; i++) if (xs[i] <= xs[i - 1]) return pts;
    const d = [];
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    const m = new Array(n);
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) {
        m[i] = 0;
        m[i + 1] = 0;
        continue;
      }
      const a = m[i] / d[i];
      const b = m[i + 1] / d[i];
      const sq = a * a + b * b;
      if (sq > 9) {
        const t = 3 / Math.sqrt(sq);
        m[i] = t * a * d[i];
        m[i + 1] = t * b * d[i];
      }
    }
    const out = [pts[0]];
    for (let i = 0; i < n - 1; i++) {
      const h = xs[i + 1] - xs[i];
      for (let k = 1; k <= per; k++) {
        const t = k / per;
        const t2 = t * t;
        const t3 = t2 * t;
        const y = (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
        out.push([xs[i] + t * h, y]);
      }
    }
    return out;
  }

  // ---------- 차트 눈금 ----------
  function niceStep(range, count, integer) {
    const raw = range / Math.max(1, count);
    const base = Math.pow(10, Math.floor(Math.log10(raw)));
    const mults = integer && base < 10 ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
    let best = base;
    for (const m of mults) {
      const step = Math.max(m * base, integer ? 1 : 0);
      if (Math.abs(range / step - count) < Math.abs(range / best - count)) best = step;
    }
    return best;
  }

  // fixed가 아니면 눈금 간격에 맞춰 범위를 넓힘
  function niceTicks(lo, hi, count, fixed, integer) {
    if (hi === lo) hi = lo + 1;
    const step = niceStep(hi - lo, count, integer);
    const a = fixed ? lo : Math.floor(lo / step) * step;
    const b = fixed ? hi : Math.ceil(hi / step) * step;
    const ticks = [];
    for (let v = Math.ceil(a / step) * step; v <= b + step / 1e6; v += step) ticks.push(+v.toFixed(10));
    return { lo: a, hi: b, ticks };
  }

  function compactNumber(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
    if (a >= 1e3) return `${+(v / 1e3).toFixed(1)}k`;
    return `${+v.toFixed(a < 10 && v % 1 ? 1 : 0)}`;
  }

  function lastDirection(pts) {
    for (let i = pts.length - 1; i > 0; i--) {
      const dx = pts[i][0] - pts[i - 1][0];
      const dy = pts[i][1] - pts[i - 1][1];
      if (Math.hypot(dx, dy) > 0.01) return Math.atan2(dy, dx);
    }
    return 0;
  }

  // 사각형 중심에서 (tx,ty) 방향으로 나가는 선이 테두리와 만나는 점
  function clipToRect(r, tx, ty, gap) {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const dx = tx - cx;
    const dy = ty - cy;
    if (dx === 0 && dy === 0) return [cx, cy];
    const sx = dx === 0 ? Infinity : r.w / 2 / Math.abs(dx);
    const sy = dy === 0 ? Infinity : r.h / 2 / Math.abs(dy);
    const s = Math.min(sx, sy);
    const len = Math.hypot(dx, dy);
    const k = s + gap / len;
    return [cx + dx * k, cy + dy * k];
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }

  // ---------- 색 토큰 (CSS 변수 --ds-*) ----------
  function readTokens(el) {
    const cs = getComputedStyle(el);
    const v = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
    const t = {
      surface: v("--ds-surface", "#fff"),
      surface2: v("--ds-surface-2", "#f8f9fa"),
      border: v("--ds-border", "#dee2e6"),
      ink: v("--ds-ink", "#212529"),
      ink2: v("--ds-ink-2", "#495057"),
      ink3: v("--ds-ink-3", "#868e96"),
      muted: v("--ds-muted", "#adb5bd"),
      roles: {},
    };
    for (const r of ROLES) {
      t.roles[r] = {
        stroke: v(`--ds-${r}`, "#228be6"),
        soft: v(`--ds-${r}-soft`, "#e7f5ff"),
        ink: v(`--ds-${r}-ink`, "#1971c2"),
      };
    }
    // 역할 없는 요소: 회색 틀 + 본문 글자
    t.roles.neutral = { stroke: t.border, soft: t.surface2, ink: t.ink2 };
    t.roles.muted = { stroke: t.muted, soft: t.surface2, ink: t.ink3 };
    return t;
  }

  // ---------- 장면 구성 (draw(g)가 채우는 노드 목록) ----------
  function createBuilder(ctx, unitScale) {
    const nodes = [];
    const byId = new Map();
    const errors = [];
    const legends = [];
    // 표 id 묶음: 묶음 id → 칸 id 목록 (sequence에서 묶음 id를 칸 id들로 펼침)
    const groups = new Map();

    const fontPx = (size) => Math.max(size, MIN_FONT_PX / unitScale);
    const setFont = (size, weight, mono) => {
      ctx.font = `${weight || 400} ${fontPx(size)}px ${mono ? MONO : FONT}`;
    };

    function wrap(text, maxWidth, size, weight, mono) {
      setFont(size, weight, mono);
      const lines = [];
      for (const para of String(text).split("\n")) {
        if (!maxWidth || ctx.measureText(para).width <= maxWidth) {
          lines.push(para);
          continue;
        }
        let line = "";
        for (const word of para.split(" ")) {
          const tryLine = line ? `${line} ${word}` : word;
          if (ctx.measureText(tryLine).width <= maxWidth || !line) {
            line = tryLine;
          } else {
            lines.push(line);
            line = word;
          }
          // 공백 없는 긴 단어는 글자 단위로 분할
          while (ctx.measureText(line).width > maxWidth && line.length > 1) {
            let cut = line.length - 1;
            while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut--;
            lines.push(line.slice(0, cut));
            line = line.slice(cut);
          }
        }
        if (line) lines.push(line);
      }
      return lines;
    }

    function textBox(lines, x, y, size, align, baseline) {
      const lh = fontPx(size) * 1.3;
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width), 0);
      const h = lh * lines.length;
      const left = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
      const top = baseline === "middle" ? y - h / 2 : y;
      return { x: left, y: top, w, h, lh };
    }

    function add(type, id, props) {
      if (!id) errors.push(`${type}: id 누락`);
      if (byId.has(id)) errors.push(`중복 id: ${id}`);
      const node = { type, id, ...props };
      nodes.push(node);
      byId.set(id, node);
      return node;
    }

    function resolvePoint(ref) {
      if (Array.isArray(ref)) return { point: ref };
      const n = byId.get(ref);
      if (!n) {
        errors.push(`연결 대상 없음: ${ref}`);
        return { point: [0, 0] };
      }
      if (n.rect) return { rect: n.rect };
      return { point: [n.x, n.y] };
    }

    function routeBetween(from, to, via, offset, gap) {
      const a = resolvePoint(from);
      const b = resolvePoint(to);
      const center = (r) => (r.rect ? [r.rect.x + r.rect.w / 2, r.rect.y + r.rect.h / 2] : r.point);
      let ca = center(a);
      let cb = center(b);
      if (offset && !via?.length) {
        const ang = Math.atan2(cb[1] - ca[1], cb[0] - ca[0]);
        const ox = -Math.sin(ang) * offset;
        const oy = Math.cos(ang) * offset;
        ca = [ca[0] + ox, ca[1] + oy];
        cb = [cb[0] + ox, cb[1] + oy];
      }
      const mids = via || [];
      const firstTarget = mids[0] || cb;
      const lastSource = mids[mids.length - 1] || ca;
      const clip = (r, c, target) => {
        if (!r.rect) return r.point;
        // offset으로 옮긴 중심 기준으로 테두리와 만나는 점
        const rr = { ...r.rect, x: c[0] - r.rect.w / 2, y: c[1] - r.rect.h / 2 };
        const p = clipToRect(rr, target[0], target[1], gap);
        return [clamp(p[0], r.rect.x - gap, r.rect.x + r.rect.w + gap), clamp(p[1], r.rect.y - gap, r.rect.y + r.rect.h + gap)];
      };
      return [clip(a, ca, firstTarget), ...mids, clip(b, cb, lastSource)];
    }

    const g = {
      box(id, o) {
        const rect = { x: o.x, y: o.y, w: o.w, h: o.h };
        const size = o.size || 13;
        const lines = o.label ? wrap(o.label, o.w - 16, size, 600) : [];
        const subLines = o.sub ? wrap(o.sub, o.w - 16, o.subSize || 11, 400) : [];
        return add("box", id, {
          rect,
          role: o.role || "neutral",
          radius: o.radius ?? 8,
          dashed: !!o.dashed,
          fill: o.fill || "soft",
          labelAt: o.labelAt || "center",
          lines,
          subLines,
          size,
          subSize: o.subSize || 11,
        });
      },
      table(id, o) {
        const cols = o.columns || [];
        const rows = (o.rows || []).map((r) => (Array.isArray(r) ? { cells: r } : r));
        const header = o.header ?? cols.some((c) => c.label);
        const rowH = o.rowH || 40;
        const size = o.size || 13;
        const xs = [];
        let right = o.x;
        for (const c of cols) {
          xs.push(right);
          right += c.w;
        }
        // 머리글 높이: 가장 긴 머리글(라벨 + sub) 기준, 모바일 최소 글자 크기 반영
        let headH = o.headH || rowH;
        if (header) {
          for (const c of cols) {
            const lines = c.label ? wrap(c.label, c.w - 16, size, 600).length : 0;
            const subs = c.sub ? wrap(c.sub, c.w - 16, 11, 400).length : 0;
            headH = Math.max(headH, lines * fontPx(size) * 1.3 + subs * fontPx(11) * 1.3 + 16);
          }
        }
        const cells = [];
        if (header) {
          cols.forEach((c, ci) => {
            cells.push({ id: `${id}.h${ci}`, groups: [`${id}.h`, `${id}.c${ci}`], x: xs[ci], y: o.y, w: c.w, h: headH, label: c.label, sub: c.sub, role: c.role, fill: "soft" });
          });
        }
        const top = o.y + (header ? headH : 0);
        rows.forEach((r, ri) => {
          r.cells.forEach((v, ci) => {
            const cell = v !== null && typeof v === "object" ? v : { text: v };
            cells.push({
              id: `${id}.r${ri}c${ci}`,
              groups: [`${id}.r${ri}`, `${id}.c${ci}`],
              x: xs[ci],
              y: top + ri * rowH,
              w: cols[ci].w,
              h: rowH,
              label: cell.text == null ? "" : String(cell.text),
              role: cell.role || r.role || cols[ci].role,
              dashed: cell.dashed ?? r.dashed ?? false,
              fill: "none",
            });
          });
        });
        // 역할 색 칸을 나중에 그려 맞닿은 회색 테두리가 색 테두리를 덮지 않게
        cells.sort((a, b) => (a.role ? 1 : 0) - (b.role ? 1 : 0));
        for (const { id: cid, groups: keys, ...c } of cells) {
          g.box(cid, { ...c, radius: 0, size });
          for (const k of [id, ...keys]) {
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k).push(cid);
          }
        }
        return { x: o.x, y: o.y, w: right - o.x, h: top + rows.length * rowH - o.y };
      },
      // 사람 모양: x y = 그림 중심, size = 그림 높이. count면 여러 명을 겹쳐 그림. 라벨은 그림 아래
      // rect는 그림과 라벨을 합친 범위: 아래로 나가는 화살표가 라벨 밑에서 시작
      person(id, o) {
        const s = o.size || 40;
        const count = Math.max(1, o.count || 1);
        const step = s * 0.45;
        const w = s * 0.8 + step * (count - 1);
        const fig = { x: o.x - w / 2, y: o.y - s / 2, w, h: s };
        const size = o.labelSize || 12;
        let label = null;
        let rect = fig;
        if (o.label) {
          setFont(size, 600);
          label = textBox([o.label], o.x, fig.y + s + 6, size, "center", "top");
          const left = Math.min(fig.x, label.x);
          rect = { x: left, y: fig.y, w: Math.max(fig.x + fig.w, label.x + label.w) - left, h: label.y + label.h - fig.y };
        }
        return add("person", id, { rect, fig, s, count, step, role: o.role || "neutral", text: o.label, size, textBox: label, radius: s * 0.2 });
      },
      // 사람 아이콘 격자(단위 차트): x y = 왼쪽 위. 앞에서부터 mark개를 역할 색, 나머지는 muted
      people(id, o) {
        const total = o.total || 100;
        const cols = o.cols || 10;
        const s = o.size || 18;
        const gap = o.gap ?? s * 0.25;
        const cw = s * 0.8 + gap;
        const rows = Math.ceil(total / cols);
        const fig = { x: o.x, y: o.y, w: cols * cw - gap, h: rows * (s + gap) - gap };
        const size = o.labelSize || 12;
        let label = null;
        let rect = fig;
        if (o.label) {
          setFont(size, 600);
          label = textBox([o.label], fig.x + fig.w / 2, fig.y + fig.h + 8, size, "center", "top");
          const left = Math.min(fig.x, label.x);
          rect = { x: left, y: fig.y, w: Math.max(fig.x + fig.w, label.x + label.w) - left, h: label.y + label.h - fig.y };
        }
        return add("people", id, { rect, fig, s, cw, gap, cols, total, mark: o.mark || 0, role: o.role || "focus", text: o.label, size, textBox: label, radius: 4 });
      },
      chip(id, o) {
        const size = o.size || 11;
        setFont(size, 700);
        const w = ctx.measureText(o.text).width + 20;
        const h = fontPx(size) + 10;
        const left = o.align === "left" ? o.x : o.align === "right" ? o.x - w : o.x - w / 2;
        return add("chip", id, { rect: { x: left, y: o.y - h / 2, w, h }, text: o.text, role: o.role || "focus", size });
      },
      text(id, o) {
        const size = o.size || 12;
        const weight = o.weight || 400;
        const align = o.align || "center";
        const lines = wrap(o.text, o.maxWidth, size, weight, o.mono);
        const box = textBox(lines, o.x, o.y, size, align, "middle");
        return add("text", id, { x: o.x, y: o.y, lines, size, weight, align, mono: !!o.mono, role: o.role, tone: o.tone || "ink2", textBox: box });
      },
      arrow(id, o) {
        // 뒤에 정의한 요소도 가리킬 수 있도록 경로 계산은 finalize에서
        return add("path", id, {
          pts: null,
          route: o,
          role: o.role || "muted",
          dashed: !!o.dashed,
          width: o.width || 1.8,
          heads: o.heads || "end",
          label: o.label,
          labelSide: o.labelSide || "above",
          labelSize: o.labelSize || 11,
        });
      },
      line(id, o) {
        return add("path", id, { pts: o.points, role: o.role || "muted", dashed: !!o.dashed, width: o.width || 1.2, heads: o.heads || "none", label: o.label, labelSide: o.labelSide || "above", labelSize: o.labelSize || 11 });
      },
      loop(id, o) {
        // 시계 방향 원 경로, gapDeg만큼 비워 화살촉 자리 확보
        const r = o.r;
        const start = ((o.startDeg ?? -90) * Math.PI) / 180;
        const sweep = ((360 - (o.gapDeg ?? 24)) * Math.PI) / 180;
        const pts = [];
        for (let i = 0; i <= 72; i++) {
          const a = start + (sweep * i) / 72;
          pts.push([o.cx + r * Math.cos(a), o.cy + r * Math.sin(a)]);
        }
        return add("path", id, { pts, role: o.role || "focus", dashed: !!o.dashed, width: o.width || 1.8, heads: "end", label: o.label, labelSide: "center", labelSize: o.labelSize || 12, loopCenter: [o.cx, o.cy] });
      },
      dot(id, o) {
        const r = o.r || 5;
        return add("dot", id, { x: o.x, y: o.y, r, role: o.role || "focus", rect: { x: o.x - r, y: o.y - r, w: r * 2, h: r * 2 } });
      },
      status(id, o) {
        return add("status", id, { x: o.x, y: o.y, at: o.at, text: o.text, role: o.role || "warn", size: o.size || 11 });
      },

      // 차트 틀: x y w h = 그림 영역(눈금 글자는 바깥에 그려짐)
      chart(id, o) {
        return add("axis", id, {
          plot: { x: o.x, y: o.y, w: o.w, h: o.h },
          xDomain: o.xDomain,
          yDomain: o.yDomain,
          xTicks: o.xTicks ?? 5,
          yTicks: o.yTicks ?? 4,
          xLabel: o.xLabel,
          yLabel: o.yLabel,
          xFormat: o.xFormat,
          yFormat: o.yFormat,
          grid: o.grid ?? true,
          role: "muted",
        });
      },
      lineSeries(id, o) {
        return add("path", id, {
          pts: null,
          data: o.data,
          chartId: o.chart,
          area: !!o.area,
          dots: !!o.dots,
          curve: o.curve === "smooth" ? "smooth" : "linear",
          role: o.role || "focus",
          dashed: !!o.dashed,
          width: o.width || 2,
          heads: "none",
          label: o.label,
          labelSide: "end",
          labelDy: o.labelDy || 0,
          labelSize: o.labelSize || 11,
        });
      },
      areaSeries(id, o) {
        return g.lineSeries(id, { ...o, area: true });
      },
      // 막대 하나하나가 요소: id는 "<id>-0", "<id>-1" ...
      // 묶은 막대: 범주마다 시리즈 막대를 나란히. id는 "<id>-<시리즈 id>-<i>"
      groupedBars(id, o) {
        legends.push({ chartId: o.chart, items: o.series.map((sr) => ({ label: sr.label, role: sr.role || "focus" })) });
        const m = o.series.length;
        const out = [];
        o.series.forEach((sr, si) => {
          if (!sr.label) errors.push(`groupedBars 시리즈 라벨 없음: ${id}/${sr.id}`);
          sr.data.forEach(([k, v], i) =>
            out.push(add("bar", `${id}-${sr.id}-${i}`, { chartId: o.chart, key: k, value: v, group: `${id}-${sr.id}`, role: sr.role || "focus", slot: [si, m], seriesLabel: sr.label, showValue: !!o.labels, format: o.format }))
          );
        });
        return out;
      },
      // 쌓은 막대: 범주마다 시리즈 값을 아래부터 쌓음. id는 "<id>-<시리즈 id>-<i>"
      stackedBars(id, o) {
        legends.push({ chartId: o.chart, items: o.series.map((sr) => ({ label: sr.label, role: sr.role || "focus" })) });
        const out = [];
        const keys = o.series[0].data.map((d) => d[0]);
        keys.forEach((k, i) => {
          let base = 0;
          o.series.forEach((sr, si) => {
            if (i === 0 && !sr.label) errors.push(`stackedBars 시리즈 라벨 없음: ${id}/${sr.id}`);
            const d = sr.data.find((x) => x[0] === k);
            const v = d ? d[1] : 0;
            out.push(add("bar", `${id}-${sr.id}-${i}`, { chartId: o.chart, key: k, value: base + v, stackBase: base, raw: v, group: `${id}-${sr.id}`, role: sr.role || "focus", seriesLabel: sr.label, topSeg: si === o.series.length - 1, format: o.format }));
            base += v;
          });
        });
        return out;
      },
      // 산점도: 점 묶음 하나가 요소. grow는 x 순서대로 점이 나타남
      scatter(id, o) {
        if (o.label) legends.push({ chartId: o.chart, items: [{ label: o.label, role: o.role || "focus" }], scatter: true });
        return add("scatter", id, { chartId: o.chart, points: o.data, role: o.role || "focus", r: o.r || 4, label: o.label });
      },
      bars(id, o) {
        return o.data.map(([k, v], i) =>
          add("bar", `${id}-${i}`, {
            chartId: o.chart,
            key: k,
            value: v,
            group: id,
            role: (o.roles && o.roles[i]) || o.role || "focus",
            showValue: !!o.labels,
            binWidth: o.binWidth,
            format: o.format,
          })
        );
      },
      // 기준선: y(가로선) 또는 x(세로선) 데이터 값
      // 시리즈 일부 구간 강조: from~to(x 값) 사이를 굵게 덧그림. 시리즈 라벨 검사 대상 아님
      segment(id, o) {
        return add("path", id, {
          pts: null,
          segOf: { series: o.series, from: o.from, to: o.to },
          role: o.role || "focus",
          dashed: false,
          width: o.width || 3.5,
          heads: "none",
          label: o.label,
          labelSide: o.labelSide || "above",
          labelSize: o.labelSize || 11,
        });
      },
      refLine(id, o) {
        return add("path", id, {
          pts: null,
          ref: { chartId: o.chart, x: o.x, y: o.y },
          role: o.role || "muted",
          dashed: o.dashed ?? true,
          width: o.width || 1.4,
          heads: "none",
          label: o.label,
          labelSide: o.labelSide || "above",
          labelAt: o.labelAt || "end",
          labelSize: o.labelSize || 11,
        });
      },
    };

    // chip/text/dot/status에 chart를 주면 x/y를 데이터 값으로 보고 finalize에서 옮김
    function withData(node, o) {
      if (o.chart) node.dataPos = { chartId: o.chart, x: o.x, y: o.y, ox: o.dx || 0, oy: o.dy || 0 };
      return node;
    }
    for (const k of ["chip", "text", "dot", "status"]) {
      const base = g[k];
      g[k] = (id, o) => (o.chart ? withData(base(id, { ...o, x: 0, y: 0, chart: undefined }), o) : base(id, o));
    }

    function chartOf(id, who) {
      const c = byId.get(id);
      if (!c || c.type !== "axis") {
        errors.push(`차트 없음: ${id} (${who})`);
        return null;
      }
      return c;
    }

    function setupCharts() {
      for (const c of nodes) {
        if (c.type !== "axis") continue;
        const series = nodes.filter((n) => n.chartId === c.id || n.ref?.chartId === c.id || n.dataPos?.chartId === c.id);
        const xs = [];
        const ys = [];
        for (const n of series) {
          if (n.data) for (const [x, y] of n.data) xs.push(x), ys.push(y);
          if (n.type === "bar") {
            ys.push(n.value);
            if (typeof n.key === "number") {
              const keys = nodes.filter((m) => m.group === n.group).map((m) => m.key).sort((a, b) => a - b);
              const diffs = keys.slice(1).map((k, i) => k - keys[i]).filter((d) => d > 0);
              n.binWidth = n.binWidth || (diffs.length ? Math.min(...diffs) : 1);
              xs.push(n.key - n.binWidth / 2, n.key + n.binWidth / 2);
            } else xs.push(n.key);
          }
          if (n.ref && n.ref.y != null) ys.push(n.ref.y);
          if (n.ref && n.ref.x != null) xs.push(n.ref.x);
          if (n.type === "scatter") for (const [x, y] of n.points) xs.push(x), ys.push(y);
        }
        const P = c.plot;
        const categorical = Array.isArray(c.xDomain) ? typeof c.xDomain[0] === "string" : xs.some((x) => typeof x === "string");
        if (categorical) {
          c.cats = Array.isArray(c.xDomain) ? c.xDomain : [...new Set(xs)];
          c.band = P.w / Math.max(1, c.cats.length);
          c.sx = (v) => {
            const i = c.cats.indexOf(v);
            if (i < 0) errors.push(`범주 없음: ${v} (${c.id})`);
            return P.x + (Math.max(0, i) + 0.5) * c.band;
          };
          c.xTickVals = c.cats;
        } else {
          const nums = xs.filter((x) => typeof x === "number");
          const lo = c.xDomain ? c.xDomain[0] : Math.min(...nums);
          const hi = c.xDomain ? c.xDomain[1] : Math.max(...nums);
          const t = niceTicks(lo, hi, c.xTicks, true, nums.every((x) => Number.isInteger(x)));
          c.xLo = lo;
          c.xHi = hi === lo ? lo + 1 : hi;
          c.sx = (v) => P.x + ((v - c.xLo) / (c.xHi - c.xLo)) * P.w;
          c.xTickVals = t.ticks;
        }
        const yNums = ys.filter((y) => typeof y === "number");
        const ylo = c.yDomain ? c.yDomain[0] : Math.min(0, ...yNums);
        const yhi = c.yDomain ? c.yDomain[1] : Math.max(...yNums, ylo + 1);
        const ty = niceTicks(ylo, yhi, c.yTicks, !!c.yDomain, yNums.every((y) => Number.isInteger(y)) && yhi - ylo >= c.yTicks);
        c.yLo = ty.lo;
        c.yHi = ty.hi;
        c.sy = (v) => P.y + P.h - ((v - c.yLo) / (c.yHi - c.yLo)) * P.h;
        c.yTickVals = ty.ticks;
        c.baseY = c.sy(Math.max(c.yLo, Math.min(0, c.yHi)));
        if (c.yDomain && yNums.some((y) => y < c.yLo - 1e-9 || y > c.yHi + 1e-9)) errors.push(`데이터가 y 범위 밖: ${c.id}`);

        // 눈금 글자 위치와 영역 (그리기/검사/높이 계산 공용)
        const fmtX = c.xFormat || ((v) => (typeof v === "number" ? compactNumber(v) : String(v)));
        const fmtY = c.yFormat || compactNumber;
        const items = [];
        const tickSize = 10;
        setFont(tickSize, 400);
        const th = fontPx(tickSize);
        // 빈 문자열을 돌려주는 눈금은 그리지도 검사하지도 않음
        for (const v of c.yTickVals) {
          const text = String(fmtY(v));
          if (!text) continue;
          const w = ctx.measureText(text).width;
          const y = c.sy(v);
          items.push({ kind: "y눈금", text, x: P.x - 8, y, align: "right", rect: { x: P.x - 8 - w, y: y - th * 0.65, w, h: th * 1.3 } });
        }
        const xItems = (vals) =>
          vals
            .map((v) => {
              const text = String(fmtX(v));
              const w = ctx.measureText(text).width;
              const x = c.sx(v);
              const y = P.y + P.h + 6 + th * 0.65;
              return { kind: "x눈금", text, x, y, align: "center", rect: { x: x - w / 2, y: y - th * 0.65, w, h: th * 1.3 } };
            })
            .filter((it) => it.text);
        let xVals = c.xTickVals;
        let xs2 = xItems(xVals);
        // 좁은 폭에서 눈금 글자끼리 겹치면 하나 걸러 하나씩 남김
        while (xVals.length > 2 && xs2.some((it, i) => i > 0 && it.rect.x < xs2[i - 1].rect.x + xs2[i - 1].rect.w + 6)) {
          xVals = xVals.filter((_, i) => i % 2 === 0);
          xs2 = xItems(xVals);
        }
        items.push(...xs2);
        // 왼쪽 아래 모서리: 바닥 y 눈금이 x 첫 눈금과 겹치면 y 눈금을 뺌 (바닥 값은 축선이 대신 보여줌)
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i];
          if (it.kind === "y눈금" && xs2.some((x) => rectsOverlap(it.rect, x.rect))) items.splice(i, 1);
        }
        if (c.yLabel) {
          const w = ctx.measureText(c.yLabel).width;
          const y = P.y - 8 - th * 0.65;
          items.push({ kind: "y축 제목", text: c.yLabel, x: P.x, y, align: "left", rect: { x: P.x, y: y - th * 0.65, w, h: th * 1.3 } });
        }
        if (c.xLabel) {
          const w = ctx.measureText(c.xLabel).width;
          const y = P.y + P.h + 6 + th * 0.65 + th * 1.5;
          items.push({ kind: "x축 제목", text: c.xLabel, x: P.x + P.w, y, align: "right", rect: { x: P.x + P.w - w, y: y - th * 0.65, w, h: th * 1.3 } });
        }
        // 범례: 시리즈마다 색 사각형 + 이름, 그림 영역 위 오른쪽부터
        const entries = legends.filter((l) => l.chartId === c.id).flatMap((l) => l.items.map((it) => ({ ...it, scatter: l.scatter })));
        const seen = new Set();
        let lx = P.x + P.w;
        const ly = P.y - 8 - th * 0.65;
        for (const e of entries.reverse()) {
          if (seen.has(e.label)) continue;
          seen.add(e.label);
          const w = ctx.measureText(e.label).width;
          const sw = 10;
          const left = lx - w - sw - 5;
          items.push({ kind: "범례", text: e.label, x: lx, y: ly, align: "right", swatch: { x: left, y: ly - sw / 2, w: sw, role: e.role, round: e.scatter }, rect: { x: left, y: ly - th * 0.65, w: w + sw + 5, h: th * 1.3 } });
          lx = left - 12;
        }
        c.tickSize = tickSize;
        c.items = items;
      }
    }

    function placeChartNodes() {
      for (const n of nodes) {
        if (n.data && n.chartId) {
          const c = chartOf(n.chartId, n.id);
          if (!c) {
            n.pts = [[0, 0], [0, 0]];
            continue;
          }
          n.dataPts = n.data.map(([x, y]) => [c.sx(x), c.sy(y)]);
          n.pts = n.curve === "smooth" ? monotonePath(n.dataPts) : n.dataPts;
          n.baseY = c.baseY;
        }
        if (n.ref) {
          const c = chartOf(n.ref.chartId, n.id);
          if (!c) {
            n.pts = [[0, 0], [0, 0]];
            continue;
          }
          const P = c.plot;
          n.pts = n.ref.y != null ? [[P.x, c.sy(n.ref.y)], [P.x + P.w, c.sy(n.ref.y)]] : [[c.sx(n.ref.x), P.y], [c.sx(n.ref.x), P.y + P.h]];
        }
        if (n.type === "bar") {
          const c = chartOf(n.chartId, n.id);
          if (!c) {
            n.rect = { x: 0, y: 0, w: 0, h: 0 };
            continue;
          }
          // 범주형: 띠 폭의 62%, 숫자형(히스토그램): 구간 폭에서 2px 간격만 뺌
          let width = c.band ? Math.min(c.band * 0.62, 56) : Math.max(2, Math.abs(c.sx(n.key + n.binWidth) - c.sx(n.key)) - 2);
          let cx = c.sx(n.key);
          if (n.slot && c.band) {
            // 묶은 막대: 띠 폭의 80%를 시리즈 수로 나누고 막대 사이 2px
            const [si, m] = n.slot;
            const groupW = Math.min(c.band * 0.8, 40 * m);
            const each = groupW / m;
            width = Math.max(2, each - 2);
            cx = cx - groupW / 2 + each * (si + 0.5);
          }
          const base = n.stackBase != null ? c.sy(n.stackBase) : c.baseY;
          const top = c.sy(n.value);
          // 쌓은 막대 조각 사이 2px 간격 (아래 조각 위쪽에서 뺌)
          const gap = n.stackBase != null && !n.topSeg ? 2 : 0;
          n.rect = { x: cx - width / 2, y: Math.min(top, base) + gap, w: width, h: Math.max(0, Math.abs(base - top) - gap) };
          n.baseY = base;
          if (n.showValue) {
            n.valueText = (n.format || compactNumber)(n.raw ?? n.value);
            setFont(10, 600);
            n.textBox = textBox([n.valueText], cx, n.rect.y - 10, 10, "center", "middle");
          }
        }
        if (n.type === "scatter") {
          const c = chartOf(n.chartId, n.id);
          n.pts = c ? n.points.map(([x, y]) => [c.sx(x), c.sy(y)]) : [];
          n.order = n.pts.map((_, i) => i).sort((a, b) => n.pts[a][0] - n.pts[b][0]);
        }
        if (n.segOf) {
          const src = byId.get(n.segOf.series);
          if (!src || !src.data) {
            errors.push(`segment 대상 시리즈 없음: ${n.segOf.series}`);
            n.pts = [[0, 0], [0, 0]];
          }
        }
        if (n.dataPos) {
          const c = chartOf(n.dataPos.chartId, n.id);
          if (!c) continue;
          const dx = c.sx(n.dataPos.x) + n.dataPos.ox;
          const dy = c.sy(n.dataPos.y) + n.dataPos.oy;
          n.x = (n.x ?? 0) + dx;
          n.y = (n.y ?? 0) + dy;
          for (const r of [n.rect, n.textBox]) if (r) (r.x += dx), (r.y += dy);
        }
      }
    }

    function placeSegments() {
      for (const n of nodes) {
        if (!n.segOf) continue;
        const src = byId.get(n.segOf.series);
        if (!src || !src.data || !src.pts) continue;
        const keys = src.data.map((d) => d[0]);
        const i0 = keys.indexOf(n.segOf.from);
        const i1 = keys.indexOf(n.segOf.to);
        if (i0 < 0 || i1 < 0 || i1 <= i0) {
          errors.push(`segment 구간 오류: ${n.id} (${n.segOf.from}~${n.segOf.to})`);
          n.pts = [[0, 0], [0, 0]];
          continue;
        }
        const x0 = src.dataPts[i0][0];
        const x1 = src.dataPts[i1][0];
        n.pts = src.pts.filter((q) => q[0] >= x0 - 0.01 && q[0] <= x1 + 0.01);
      }
    }

    function finalize() {
      setupCharts();
      placeChartNodes();
      placeSegments();
      for (const n of nodes) {
        if (n.route) {
          const o = n.route;
          n.pts = routeBetween(o.from, o.to, o.via, o.offset || 0, o.gap ?? 6);
        }
        if (n.type === "status") {
          if (n.at) {
            const t = byId.get(n.at);
            if (!t?.rect) errors.push(`status 기준 없음: ${n.at}`);
            else {
              n.x = t.rect.x + t.rect.w / 2;
              n.y = t.rect.y + t.rect.h + 16;
            }
          }
          setFont(n.size, 600);
          n.textBox = textBox([`${n.text}...`], n.x, n.y, n.size, "center", "middle");
        }
        if (n.type === "path" && n.label) {
          setFont(n.labelSize, 600);
          n.labelW = ctx.measureText(n.label).width;
          n.labelH = fontPx(n.labelSize);
        }
      }
      separateEndLabels();
    }

    // 같은 차트의 시리즈 끝 라벨이 가까우면 위아래로 벌림
    function separateEndLabels() {
      const groups = {};
      for (const n of nodes) if (n.labelSide === "end" && n.label && n.chartId) (groups[n.chartId] ||= []).push(n);
      for (const list of Object.values(groups)) {
        if (list.length < 2) continue;
        const items = list
          .map((n) => ({ n, y: n.pts[n.pts.length - 1][1] + (n.labelDy || 0) }))
          .sort((a, b) => a.y - b.y);
        const gap = Math.max(...list.map((n) => n.labelH)) * 1.35;
        for (let i = 1; i < items.length; i++) {
          if (items[i].y - items[i - 1].y < gap) {
            const need = gap - (items[i].y - items[i - 1].y);
            items[i - 1].y -= need / 2;
            items[i].y += need / 2;
          }
        }
        for (const it of items) it.n.labelDy = it.y - it.n.pts[it.n.pts.length - 1][1];
      }
    }

    return { g, nodes, byId, groups, errors, setFont, fontPx, finalize };
  }

  // ---------- 그리기 ----------
  function drawArrowHead(ctx, x, y, ang, size) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - size * Math.cos(ang) + size * 0.55 * Math.sin(ang), y - size * Math.sin(ang) - size * 0.55 * Math.cos(ang));
    ctx.lineTo(x - size * Math.cos(ang) - size * 0.55 * Math.sin(ang), y - size * Math.sin(ang) + size * 0.55 * Math.cos(ang));
    ctx.closePath();
    ctx.fill();
  }

  function strokePath(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }

  function pathLabelPos(node) {
    if (node.loopCenter) return node.loopCenter;
    if (node.labelSide === "end") {
      const [ex, ey] = node.pts[node.pts.length - 1];
      return [ex + 8 + (node.labelW || 0) / 2, ey + (node.labelDy || 0)];
    }
    if (node.ref && node.labelAt !== "middle") {
      // 기준선 라벨: 선의 끝(가로선은 오른쪽, 세로선은 위)에 붙임
      const [ex, ey] = node.pts[node.pts.length - 1];
      const [sx0, sy0] = node.pts[0];
      if (node.ref.y != null) {
        const x = node.labelAt === "start" ? sx0 + (node.labelW || 0) / 2 : ex - (node.labelW || 0) / 2;
        return [x, ey + (node.labelSide === "below" ? 1 : -1) * (6 + (node.labelH || 11) / 2)];
      }
      // 세로선: 위 끝, labelSide "left"면 선 왼쪽
      const side = node.labelSide === "left" ? -1 : 1;
      return [sx0 + side * (6 + (node.labelW || 0) / 2), sy0 + (node.labelH || 11) / 2];
    }
    const [x, y] = pointAt(node.pts, 0.5);
    const a = lastDirection(slicePath(node.pts, 0.5));
    // 선과 수직 방향 단위벡터, 수평선 기준 위쪽(above)이 음수 y가 되도록 부호 고정
    let nx = -Math.sin(a);
    let ny = Math.cos(a);
    if (ny > 0 || (Math.abs(ny) < 1e-6 && nx < 0)) {
      nx = -nx;
      ny = -ny;
    }
    const side = node.labelSide === "below" ? -1 : 1;
    // 라벨 상자가 선에 닿지 않을 만큼: 수직 방향으로 투영한 반폭/반높이 + 여백
    const d = 6 + (Math.abs(nx) * (node.labelW || 0)) / 2 + (Math.abs(ny) * (node.labelH || 11)) / 2;
    return [x + nx * d * side, y + ny * d * side];
  }

  // 사람 모양 하나: cx = 가로 중심, top = 머리 위 끝, s = 높이
  function personPath(ctx, cx, top, s) {
    ctx.beginPath();
    ctx.arc(cx, top + s * 0.22, s * 0.2, 0, Math.PI * 2);
    ctx.roundRect(cx - s * 0.4, top + s * 0.5, s * 0.8, s * 0.5, [s * 0.4, s * 0.4, s * 0.06, s * 0.06]);
  }

  function paintNode(ctx, b, tk, node, st, elapsed) {
    const role = tk.roles[node.role] || tk.roles.neutral;
    ctx.save();
    ctx.globalAlpha = st.alpha;

    if (node.type === "box") {
      const { x, y, w, h } = node.rect;
      if (st.scale !== 1) {
        ctx.translate(x + w / 2, y + h / 2);
        ctx.scale(st.scale, st.scale);
        ctx.translate(-(x + w / 2), -(y + h / 2));
      }
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, node.radius);
      if (node.fill !== "none") {
        ctx.fillStyle = node.fill === "solid" ? role.stroke : role.soft;
        ctx.fill();
      }
      ctx.strokeStyle = role.stroke;
      ctx.lineWidth = node.role === "neutral" ? 1 : 1.4;
      ctx.setLineDash(node.dashed ? [5, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      const textColor = node.fill === "solid" ? tk.surface : node.role === "neutral" ? tk.ink2 : role.ink;
      b.setFont(node.size, 600);
      const lh = b.fontPx(node.size) * 1.3;
      const slh = b.fontPx(node.subSize) * 1.3;
      const blockH = node.lines.length * lh + node.subLines.length * slh;
      let ty = node.labelAt === "top" ? y + 12 + lh / 2 : y + h / 2 - blockH / 2 + lh / 2;
      ctx.fillStyle = textColor;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const l of node.lines) {
        ctx.fillText(l, x + w / 2, ty);
        ty += lh;
      }
      b.setFont(node.subSize, 400);
      ctx.fillStyle = node.fill === "solid" ? tk.surface : tk.ink3;
      ty += (slh - lh) / 2;
      for (const l of node.subLines) {
        ctx.fillText(l, x + w / 2, ty);
        ty += slh;
      }
    } else if (node.type === "chip") {
      const { x, y, w, h } = node.rect;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, h / 2);
      ctx.fillStyle = role.soft;
      ctx.fill();
      b.setFont(node.size, 700);
      ctx.fillStyle = role.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(node.text, x + w / 2, y + h / 2 + 0.5);
    } else if (node.type === "text") {
      b.setFont(node.size, node.weight, node.mono);
      ctx.fillStyle = node.role ? role.ink : tk[node.tone] || tk.ink2;
      ctx.textAlign = node.align;
      ctx.textBaseline = "middle";
      const { lh } = node.textBox;
      let ty = node.y - ((node.lines.length - 1) * lh) / 2;
      for (const l of node.lines) {
        ctx.fillText(l, node.x, ty);
        ty += lh;
      }
    } else if (node.type === "path") {
      const pts = st.progress >= 1 ? node.pts : node.data || node.segOf ? slicePathX(node.pts, st.progress) : slicePath(node.pts, st.progress);
      if (node.area && pts.length >= 2) {
        ctx.save();
        ctx.globalAlpha = st.alpha * 0.14;
        ctx.fillStyle = role.stroke;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], node.baseY);
        for (const q of pts) ctx.lineTo(q[0], q[1]);
        ctx.lineTo(pts[pts.length - 1][0], node.baseY);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      if (pts.length >= 2) {
        ctx.strokeStyle = role.stroke;
        ctx.fillStyle = role.stroke;
        ctx.lineWidth = node.width;
        ctx.lineCap = "round";
        ctx.setLineDash(node.dashed ? [4, 3] : []);
        strokePath(ctx, pts);
        ctx.setLineDash([]);
        const head = 7;
        // 자라기 시작한 직후 화살촉만 떠 보이지 않도록, 그린 길이가 화살촉의 2배 이상일 때만
        if ((node.heads === "end" || node.heads === "both") && pathLength(pts) >= head * 2) {
          const e = pts[pts.length - 1];
          drawArrowHead(ctx, e[0], e[1], lastDirection(pts), head);
        }
        if ((node.heads === "start" || node.heads === "both") && st.progress >= 1) {
          const rev = [...node.pts].reverse();
          drawArrowHead(ctx, rev[rev.length - 1][0], rev[rev.length - 1][1], lastDirection(rev), head);
        }
        if (node.dots) {
          // 이미 지나간 데이터 점만 표시
          const drawnX = pts[pts.length - 1][0];
          for (const q of node.dataPts || node.pts) {
            if (q[0] > drawnX + 0.5) break;
            ctx.beginPath();
            ctx.arc(q[0], q[1], 4, 0, Math.PI * 2);
            ctx.fillStyle = role.stroke;
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = tk.surface;
            ctx.stroke();
          }
        }
      }
      if (node.label) {
        const [lx, ly] = pathLabelPos(node);
        b.setFont(node.labelSize, 600);
        // 시리즈 끝 라벨은 선이 끝에 닿을 무렵 나타남
        const show = node.labelSide === "end" ? clamp((st.progress - 0.9) / 0.1, 0, 1) : clamp(st.progress * 1.4, 0, 1);
        ctx.globalAlpha = st.alpha * show;
        ctx.fillStyle = role.ink;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(node.label, lx, ly);
      }
    } else if (node.type === "axis") {
      const P = node.plot;
      ctx.lineWidth = 1;
      if (node.grid) {
        ctx.strokeStyle = tk.border;
        for (const v of node.yTickVals) {
          const y = Math.round(node.sy(v)) + 0.5;
          ctx.beginPath();
          ctx.moveTo(P.x, y);
          ctx.lineTo(P.x + P.w, y);
          ctx.stroke();
        }
      }
      ctx.strokeStyle = tk.muted;
      ctx.beginPath();
      ctx.moveTo(P.x, Math.round(node.baseY) + 0.5);
      ctx.lineTo(P.x + P.w, Math.round(node.baseY) + 0.5);
      ctx.stroke();
      b.setFont(node.tickSize, 400);
      ctx.fillStyle = tk.ink3;
      ctx.textBaseline = "middle";
      for (const it of node.items) {
        if (it.swatch) {
          const sw = it.swatch;
          ctx.fillStyle = (tk.roles[sw.role] || tk.roles.focus).stroke;
          ctx.beginPath();
          if (sw.round) ctx.arc(sw.x + sw.w / 2, sw.y + sw.w / 2, sw.w / 2, 0, Math.PI * 2);
          else ctx.roundRect(sw.x, sw.y, sw.w, sw.w, 2);
          ctx.fill();
          ctx.fillStyle = tk.ink2;
        } else ctx.fillStyle = tk.ink3;
        ctx.textAlign = it.align;
        ctx.fillText(it.text, it.x, it.y);
      }
    } else if (node.type === "bar") {
      const { x, w } = node.rect;
      const h = node.rect.h * st.progress;
      const up = node.rect.y < node.baseY - 0.01;
      const y = up ? node.baseY - h : node.baseY;
      if (h > 0.2) {
        // 쌓은 막대는 맨 위 조각만 둥글게
        const r = node.stackBase != null && !node.topSeg ? 0 : Math.min(4, w / 2, h);
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, up ? [r, r, 0, 0] : [0, 0, r, r]);
        ctx.fillStyle = role.stroke;
        ctx.fill();
      }
      if (node.valueText) {
        b.setFont(10, 600);
        ctx.globalAlpha = st.alpha * clamp((st.progress - 0.7) / 0.3, 0, 1);
        ctx.fillStyle = tk.ink2;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(node.valueText, x + w / 2, node.textBox.y + node.textBox.h / 2);
      }
    } else if (node.type === "scatter") {
      const shown = Math.ceil(node.order.length * st.progress);
      for (let k = 0; k < shown; k++) {
        const [x, y] = node.pts[node.order[k]];
        ctx.beginPath();
        ctx.arc(x, y, node.r, 0, Math.PI * 2);
        ctx.fillStyle = role.stroke;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = tk.surface;
        ctx.stroke();
      }
    } else if (node.type === "person") {
      const { x, y, w, h } = node.fig;
      if (st.scale !== 1) {
        ctx.translate(x + w / 2, y + h / 2);
        ctx.scale(st.scale, st.scale);
        ctx.translate(-(x + w / 2), -(y + h / 2));
      }
      const s = node.s;
      // 뒤 사람부터 그리고, 겹친 경계는 배경색 테두리로 구분
      for (let i = node.count - 1; i >= 0; i--) {
        personPath(ctx, x + s * 0.4 + i * node.step, y, s);
        // 배경색 테두리를 먼저 그리고 채움: 테두리가 바깥쪽으로만 보여 count와 관계없이 크기가 같음
        if (node.count > 1) {
          ctx.lineWidth = 4;
          ctx.strokeStyle = tk.surface;
          ctx.stroke();
        }
        // 회색 틀(neutral) 색은 배경과 너무 가까워 muted로 칠함
        ctx.fillStyle = (node.role === "neutral" ? tk.roles.muted : role).stroke;
        ctx.fill();
      }
      if (node.text) {
        const r = node.textBox;
        b.setFont(node.size, 600);
        ctx.fillStyle = node.role === "neutral" ? tk.ink2 : role.ink;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(node.text, r.x + r.w / 2, r.y + r.h / 2);
      }
    } else if (node.type === "people") {
      const { x, y, w, h } = node.fig;
      if (st.scale !== 1) {
        ctx.translate(x + w / 2, y + h / 2);
        ctx.scale(st.scale, st.scale);
        ctx.translate(-(x + w / 2), -(y + h / 2));
      }
      const s = node.s;
      for (let i = 0; i < node.total; i++) {
        const c = i % node.cols;
        const r = Math.floor(i / node.cols);
        personPath(ctx, x + c * node.cw + s * 0.4, y + r * (s + node.gap), s);
        // 표시하지 않은 사람은 배경에 가까운 회색, highlight 전(muted)에는 모두 회색
        ctx.fillStyle = i < node.mark && node.role !== "muted" ? role.stroke : tk.border;
        ctx.fill();
      }
      if (node.text) {
        const r = node.textBox;
        b.setFont(node.size, 600);
        ctx.fillStyle = tk.ink2;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(node.text, r.x + r.w / 2, r.y + r.h / 2);
      }
    } else if (node.type === "dot") {
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
      ctx.fillStyle = role.stroke;
      ctx.fill();
    } else if (node.type === "status") {
      b.setFont(node.size, 600);
      ctx.fillStyle = role.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const dots = st.animating ? ".".repeat(1 + (Math.floor(elapsed / 350) % 3)) : "...";
      ctx.fillText(node.text + dots, node.x, node.y);
    }
    ctx.restore();
  }

  function paintOverlay(ctx, b, tk, node, item, local, elapsed) {
    const role = tk.roles[item.role || node.role] || tk.roles.focus;
    ctx.save();
    if (item.effect === "travel" || item.effect === "cycle") {
      if (!node.pts) return ctx.restore();
      const laps = item.effect === "cycle" ? item.laps || 2 : 1;
      const f = item.effect === "cycle" ? (local * laps) % 1 : easeInOutCubic(local);
      const [x, y] = pointAt(node.pts, f);
      if (item.token) {
        b.setFont(10, 600, true);
        const w = ctx.measureText(item.token).width + 14;
        const h = b.fontPx(10) + 8;
        ctx.beginPath();
        ctx.roundRect(x - w / 2, y - h / 2, w, h, 4);
        ctx.fillStyle = role.soft;
        ctx.fill();
        ctx.strokeStyle = role.stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = role.ink;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(item.token, x, y + 0.5);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = role.stroke;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = tk.surface;
        ctx.stroke();
      }
    } else if (item.effect === "pulse") {
      const r = node.rect || (node.textBox ? node.textBox : null);
      if (!r) return ctx.restore();
      const grow = 2 + 8 * local;
      ctx.globalAlpha = 1 - local;
      ctx.strokeStyle = role.stroke;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(r.x - grow, r.y - grow, r.w + grow * 2, r.h + grow * 2, (node.radius ?? 8) + grow);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 진행률 p에서 각 노드의 표시 상태
  function nodeStates(nodes, sequence, p) {
    const states = new Map();
    for (const n of nodes) {
      // highlight: 구간 전에는 회색, 구간 동안 역할 색으로 바뀜 (tint 0 → 1)
      const hl = sequence.find((s) => s.id === n.id && TINT.has(s.effect));
      // breathe(약하게): 역할 색과 회색을 부드럽게 오감. 진행률 0과 1에서 역할 색이라 반복 이음매가 없음
      const tint = !hl ? 1 : hl.breathe ? 0.5 + 0.5 * Math.cos(2 * Math.PI * hl.breathe * p) : easeInOutCubic(clamp((p - hl.from) / Math.max(0.0001, hl.to - hl.from), 0, 1));
      const items = sequence.filter((s) => s.id === n.id && REVEAL.has(s.effect));
      if (!items.length) {
        states.set(n.id, { alpha: 1, progress: 1, scale: 1, animating: false, tint });
        continue;
      }
      const first = items.reduce((a, s) => (s.from < a.from ? s : a));
      const local = clamp((p - first.from) / Math.max(0.0001, first.to - first.from), 0, 1);
      const e = easeInOutCubic(local);
      const st = { alpha: 1, progress: 1, scale: 1, animating: local > 0 && local < 1, tint };
      if (first.breathe) st.alpha = 0.5 + 0.5 * Math.cos(2 * Math.PI * first.breathe * p);
      else if (p < first.from) st.alpha = 0;
      else if (first.effect === "grow") {
        if (n.type === "path" || n.type === "bar" || n.type === "scatter") st.progress = e;
        else {
          st.alpha = e;
          st.scale = 0.96 + 0.04 * e;
        }
      } else if (first.effect === "fade") st.alpha = e;
      else if (first.effect === "status") {
        st.alpha = clamp(local * 3, 0, 1);
        st.animating = p >= first.from && p <= first.to;
      }
      states.set(n.id, st);
    }
    return states;
  }

  // ---------- 검증 (텍스트 겹침/넘침, 잘못된 sequence) ----------
  function validate(name, b, sequence, designW, height) {
    const issues = [...b.errors];
    for (const s of sequence) {
      if (!b.byId.has(s.id)) issues.push(`sequence id 없음: ${s.id}`);
      if (!REVEAL.has(s.effect) && !OVERLAY.has(s.effect) && !TINT.has(s.effect)) issues.push(`알 수 없는 effect: ${s.effect}`);
      const target = b.byId.get(s.id);
      if (TINT.has(s.effect) && target && (!target.role || target.role === "neutral" || target.role === "muted")) issues.push(`highlight 대상에 역할 색이 없음: ${s.id}`);
      if (!(s.from >= 0 && s.to <= 1 && s.from < s.to)) issues.push(`구간 오류(${s.id}): from ${s.from}, to ${s.to}`);
      if ((s.effect === "travel" || s.effect === "cycle") && b.byId.get(s.id) && !b.byId.get(s.id).pts) issues.push(`${s.effect}는 arrow/line/loop에만: ${s.id}`);
    }
    const texts = [];
    for (const n of b.nodes) {
      // 그림 속 사람 수는 인원으로 읽히지 않음: 인원수는 라벨, 비율이 결론이면 people
      if (n.type === "person" && n.count > PERSON_MAX) issues.push(`person count ${n.count}: ${PERSON_MAX} 이하로 그리고 인원수는 label에 (비율이 결론이면 people): ${n.id}`);
      if (n.textBox) texts.push({ id: n.id, r: n.textBox });
      if (n.type === "chip") texts.push({ id: n.id, r: n.rect });
      if (n.type === "box") {
        b.setFont(n.size, 600);
        const lh = b.fontPx(n.size) * 1.3;
        const slh = b.fontPx(n.subSize) * 1.3;
        const need = n.lines.length * lh + n.subLines.length * slh + (n.labelAt === "top" ? 12 : 8);
        if (need > n.rect.h) issues.push(`박스 글자가 높이를 넘음: ${n.id}`);
      }
      if (n.type === "path" && n.label) {
        texts.push({ id: n.id + ":label", r: labelRect(n) });
      }
      if (n.type === "axis") n.items.forEach((it) => texts.push({ id: `${n.id}:${it.kind}(${it.text})`, r: it.rect }));
    }
    // 한 차트에 시리즈가 2개 이상이면 각각 라벨이 있어야 색만으로 구분하지 않음
    for (const c of b.nodes.filter((n) => n.type === "axis")) {
      const series = b.nodes.filter((n) => n.chartId === c.id && n.data);
      if (series.length >= 2) for (const sr of series) if (!sr.label) issues.push(`시리즈 라벨 없음(시리즈 ${series.length}개): ${sr.id}`);
    }
    // 상자 라벨도 다른 글자와 겹치면 안 되므로 목록에 추가
    const boxes = b.nodes.filter((n) => n.type === "box");
    for (const n of boxes) {
      const lr = boxLabelRect(b, n);
      if (lr) texts.push({ id: n.id + ":label", r: lr, boxLabel: n.id });
    }
    // 자유 글자가 상자 테두리에 걸치는지 (완전히 안쪽이나 바깥이면 정상)
    for (const t of texts) {
      if (t.boxLabel) continue;
      for (const n of boxes) {
        const r = t.r;
        const q = n.rect;
        if (!rectsOverlap(r, q)) continue;
        const inside = r.x >= q.x - 0.5 && r.y >= q.y - 0.5 && r.x + r.w <= q.x + q.w + 0.5 && r.y + r.h <= q.y + q.h + 0.5;
        if (!inside) issues.push(`글자가 상자 테두리에 걸침: ${t.id} / ${n.id}`);
      }
    }
    // 점(dot)이 글자(상자 라벨 포함)를 가리는지
    for (const d of b.nodes.filter((n) => n.type === "dot")) {
      for (const t of texts) if (rectsOverlap(d.rect, t.r)) issues.push(`점이 글자를 가림: ${d.id} / ${t.id}`);
    }
    for (let i = 0; i < texts.length; i++) {
      const r = texts[i].r;
      if (r.x < 0 || r.x + r.w > designW + 0.5) issues.push(`가로로 넘침: ${texts[i].id}`);
      for (let j = i + 1; j < texts.length; j++) {
        if (rectsOverlap(r, texts[j].r)) issues.push(`글자 겹침: ${texts[i].id} / ${texts[j].id}`);
      }
    }
    for (const n of b.nodes) {
      const r = n.rect || n.textBox;
      if (r && (r.x < -0.5 || r.x + r.w > designW + 0.5)) issues.push(`가로로 넘침: ${n.id}`);
    }

    // 선이 배경 없는 글자를 가로지르는지 (chip은 선보다 나중에 그리면 선을 덮으므로 제외)
    const order = new Map(b.nodes.map((n, i) => [n.id, i]));
    const crossTargets = [];
    for (const n of b.nodes) {
      if (n.type === "text" || n.type === "status" || ((n.type === "person" || n.type === "people") && n.textBox)) crossTargets.push({ id: n.id, r: n.textBox, owner: n.id });
      if (n.type === "chip") crossTargets.push({ id: n.id, r: n.rect, owner: n.id, chip: true });
      if (n.type === "path" && n.label) crossTargets.push({ id: n.id + ":label", r: labelRect(n), owner: n.id });
    }
    for (const n of b.nodes) {
      if (n.type !== "path" || !n.pts) continue;
      for (const t of crossTargets) {
        if (t.owner === n.id) continue;
        // 화살표/선은 나중에 그린 chip이 덮어도 되지만, 데이터 시리즈를 칩이 가리면 데이터가 안 보임
        if (t.chip && order.get(t.owner) > order.get(n.id) && !n.data && !n.segOf) continue;
        // 가장자리에 닿기만 해도 읽기 어려우므로 3만큼 넓혀 검사
        const r = { x: t.r.x - 3, y: t.r.y - 3, w: t.r.w + 6, h: t.r.h + 6 };
        for (let i = 1; i < n.pts.length; i++) {
          if (segmentHitsRect(n.pts[i - 1], n.pts[i], r)) {
            issues.push(`선이 글자를 가로지름: ${n.id} → ${t.id}`);
            break;
          }
        }
      }
    }

    // 글자(칩/라벨/자유 글자)가 막대를 가리는지 (막대 자신의 값 라벨은 막대 위라 제외)
    for (const bar of b.nodes.filter((n) => n.type === "bar")) {
      for (const t of crossTargets) {
        if (rectsOverlap(t.r, bar.rect)) issues.push(`글자가 막대를 가림: ${t.id} / ${bar.id}`);
      }
    }

    // 화살표 도착 시점에 대상이 절반도 안 보이는지 (대상 등장 구간의 중간 지점 기준)
    const revealOf = (id) => {
      const items = sequence.filter((s) => s.id === id && REVEAL.has(s.effect));
      return items.length ? items.reduce((a, s) => (s.from < a.from ? s : a)) : null;
    };
    for (const n of b.nodes) {
      if (!n.route || typeof n.route.to !== "string") continue;
      const target = revealOf(n.route.to);
      if (!target) continue;
      const own = revealOf(n.id);
      const arrive = own ? own.to : 0;
      const half = +((target.from + target.to) / 2).toFixed(3);
      if (arrive < half - 0.005) issues.push(`화살표 도착(${arrive}) 때 대상이 절반도 안 보임: ${n.id} → ${n.route.to}(등장 중간 ${half})`);
    }
    return { name, height: Math.round(height), issues: [...new Set(issues)] };
  }

  let measureCtx = null;

  // 상자 안 라벨+보조 줄이 차지하는 영역 (paintNode의 배치와 같은 계산)
  function boxLabelRect(b, n) {
    if (!n.lines.length && !n.subLines.length) return null;
    b.setFont(n.size, 600);
    const lh = b.fontPx(n.size) * 1.3;
    let w = Math.max(0, ...n.lines.map((l) => measureCtx.measureText(l).width));
    b.setFont(n.subSize, 400);
    const slh = b.fontPx(n.subSize) * 1.3;
    w = Math.max(w, ...n.subLines.map((l) => measureCtx.measureText(l).width));
    const h = n.lines.length * lh + n.subLines.length * slh;
    const top = n.labelAt === "top" ? n.rect.y + 12 : n.rect.y + n.rect.h / 2 - h / 2;
    return { x: n.rect.x + n.rect.w / 2 - w / 2, y: top, w, h };
  }

  function sceneBounds(nodes) {
    let minY = Infinity;
    let maxY = -Infinity;
    const take = (y0, y1) => {
      minY = Math.min(minY, y0);
      maxY = Math.max(maxY, y1);
    };
    for (const n of nodes) {
      for (const r of [n.rect, n.textBox]) if (r) take(r.y, r.y + r.h);
      if (n.type === "axis") {
        take(n.plot.y, n.plot.y + n.plot.h);
        for (const it of n.items) take(it.rect.y, it.rect.y + it.rect.h);
      }
      if (n.pts) for (const p of n.pts) take(p[1] - 5, p[1] + 5);
      if (n.type === "path" && n.label) {
        const r2 = labelRect(n);
        take(r2.y, r2.y + r2.h);
      }
    }
    if (!isFinite(minY)) return { minY: 0, maxY: 0 };
    return { minY, maxY };
  }

  function labelRect(n) {
    const [lx, ly] = pathLabelPos(n);
    return { x: lx - n.labelW / 2, y: ly - n.labelH * 0.65, w: n.labelW, h: n.labelH * 1.3 };
  }

  // 선분과 사각형 교차 (Liang-Barsky)
  function segmentHitsRect(p0, p1, r) {
    let t0 = 0;
    let t1 = 1;
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const checks = [
      [-dx, p0[0] - r.x],
      [dx, r.x + r.w - p0[0]],
      [-dy, p0[1] - r.y],
      [dy, r.y + r.h - p0[1]],
    ];
    for (const [pp, q] of checks) {
      if (pp === 0) {
        if (q < 0) return false;
      } else {
        const t = q / pp;
        if (pp < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
        if (t0 > t1) return false;
      }
    }
    return true;
  }

  // ---------- createDiagram / createDemo ----------
  const circled = (i) => (i < 20 ? String.fromCharCode(0x2460 + i) : `(${i + 1})`);

  function createScene(host, opts, mode) {
    if (typeof host === "string") host = document.querySelector(host);
    const name = opts.name || host.id || `diagram-${reports.length + 1}`;
    // createDemo: 진행률 at부터 해당 캡션 (at 오름차순, 첫 단계는 0)
    const steps = mode === "demo" ? (opts.steps || []).map((st) => ({ ...st })) : [];
    // { ids: [...], stagger } 묶음을 id별 항목으로 펼침
    const rawSequence = [];
    for (const s of opts.sequence || []) {
      if (!Array.isArray(s.ids)) {
        rawSequence.push({ ...s });
        continue;
      }
      const step = s.stagger || 0;
      s.ids.forEach((id, i) => {
        const { ids, stagger, ...rest } = s;
        rawSequence.push({ ...rest, id, from: +(s.from + i * step).toFixed(4), to: +(s.to + i * step).toFixed(4) });
      });
    }
    // 표 묶음 id를 칸 id로 펼친 결과. 칸은 draw를 실행해야 생기므로 layout마다 다시 계산
    const sequence = [];
    const expandGroups = (b) => {
      sequence.length = 0;
      for (const s of rawSequence) {
        const members = b.groups.get(s.id);
        if (!members) {
          sequence.push(s);
          continue;
        }
        for (const id of members) {
          const role = b.byId.get(id).role;
          // highlight는 역할 색이 있는 칸에만
          if (TINT.has(s.effect) && (role === "neutral" || role === "muted")) continue;
          sequence.push({ ...s, id });
        }
      }
      if (motion === "soft") softenSequence(b);
    };
    // 약하게: 모든 요소가 처음부터 보이고, 대본이 짚는 요소만 원래 순서대로 가볍게 움직임
    // 색 바꾸기 → 재생 내내 역할 색과 회색을 오감, 기준선 → 나타났다 사라졌다 반복, 화살표/연결선 → 점이 지나감, 칩/진행 표시 → 테두리 고리
    // 데이터(막대/시리즈/점)와 상자가 나타나는 효과는 버림
    const softenSequence = (b) => {
      const kept = [];
      const seen = new Set();
      for (const s of sequence) {
        const n = b.byId.get(s.id);
        if (!n) continue;
        let item = null;
        if (TINT.has(s.effect)) item = { ...s, from: 0, to: 1, breathe: 2 };
        else if (OVERLAY.has(s.effect)) item = s;
        else if (n.type === "path" && n.ref) item = { ...s, effect: "fade", from: 0, to: 1, breathe: 2 };
        else if (n.type === "path" && !n.data) item = { ...s, effect: "travel" };
        else if (n.type === "chip" || n.type === "status") item = { ...s, effect: "pulse" };
        if (!item) continue;
        // 한 요소에 같은 종류 덧그림은 하나만 (선은 travel/cycle 중 먼저 나온 것)
        const key = `${s.id}:${item.effect === "travel" || item.effect === "cycle" ? "path" : item.effect}`;
        if (seen.has(key)) continue;
        seen.add(key);
        kept.push(item);
      }
      sequence.length = 0;
      const moving = kept.filter((s) => !s.breathe);
      sequence.push(...kept.filter((s) => s.breathe));
      if (!moving.length) return;
      // 덧그림은 재생 시간 전체에 다시 배치
      const lo = Math.min(...moving.map((s) => s.from));
      const hi = Math.max(...moving.map((s) => s.to));
      const at = (v) => (hi > lo ? +(0.05 + ((v - lo) / (hi - lo)) * 0.9).toFixed(4) : v);
      for (const s of moving) sequence.push({ ...s, from: at(s.from), to: at(s.to) });
    };
    const timing =
      mode === "demo"
        ? { play: 2600 * Math.max(1, steps.length), hold: HOLD_MS, ...(opts.timing || {}) }
        : // 약하게는 진행률 0부터 완성 그림이라 멈춤 없이 반복
          { play: 3000, hold: opts.motion === "soft" ? 0 : HOLD_MS, ...(opts.timing || {}) };
    const lab = mode === "lab";
    // motion: "full"(기본) | "soft"(설명 요소만 움직임) | "off"(완성 그림만)
    const motion = lab ? "full" : opts.motion || "full";
    if (motion === "off") rawSequence.length = 0;
    const animated = lab || rawSequence.length > 0;
    // createLab 상태: ctl = 조작 값, sim = 시뮬레이션 상태(init/step이 관리)
    const ctl = {};
    let sim = null;
    let simTime = 0;
    let running = false;
    let labBase = null;
    const LAB_DT = 1000 / 30;

    host.classList.add("ds-card");
    const figure = document.createElement("figure");
    figure.className = "ds-figure";
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    const stepLabel = (i) => `${circled(i)} ${steps[i].caption}`;
    canvas.setAttribute("aria-label", opts.alt || (steps.length ? steps.map((_, i) => stepLabel(i)).join(" ") : opts.caption) || name);
    let runBtn = null;
    let metricEls = null;
    const runLabels = ["실행", "멈춤"];
    if (lab) {
      const bar = document.createElement("div");
      bar.className = "ds-controls";
      for (const c of opts.controls || []) {
        if (c.type === "toggle") {
          ctl[c.id] = c.value ?? c.options[0][0];
          const seg = document.createElement("div");
          seg.className = "ds-seg";
          seg.setAttribute("role", "group");
          if (c.label) seg.setAttribute("aria-label", c.label);
          const btns = c.options.map(([v, label]) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = label;
            btn.setAttribute("aria-pressed", String(v === ctl[c.id]));
            btn.addEventListener("click", () => {
              ctl[c.id] = v;
              btns.forEach((x, k) => x.setAttribute("aria-pressed", String(c.options[k][0] === v)));
              resetSim();
              redraw();
            });
            return seg.appendChild(btn);
          });
          bar.appendChild(seg);
        } else if (c.type === "run") {
          if (c.labels) runLabels.splice(0, 2, ...c.labels);
          runBtn = document.createElement("button");
          runBtn.type = "button";
          runBtn.className = "ds-btn ds-primary";
          runBtn.textContent = runLabels[0];
          runBtn.addEventListener("click", () => setRunning(!running));
          bar.appendChild(runBtn);
        } else if (c.type === "reset") {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "ds-btn";
          btn.textContent = c.label || "처음으로";
          btn.addEventListener("click", () => {
            resetSim();
            setRunning(false);
            redraw();
          });
          bar.appendChild(btn);
        } else if (c.type === "action") {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "ds-btn";
          btn.textContent = c.label;
          btn.addEventListener("click", () => {
            c.onClick && c.onClick(sim, ctl);
            if (!running) redraw();
          });
          bar.appendChild(btn);
        } else if (c.type === "slider") {
          ctl[c.id] = c.value ?? c.min;
          const wrap = document.createElement("label");
          wrap.className = "ds-slider";
          const name = document.createElement("span");
          name.textContent = c.label || c.id;
          const input = document.createElement("input");
          Object.assign(input, { type: "range", min: c.min, max: c.max, step: c.step ?? 1, value: ctl[c.id] });
          const out = document.createElement("b");
          const fmt = c.format || ((v) => String(v));
          out.textContent = fmt(ctl[c.id]);
          input.addEventListener("input", () => {
            ctl[c.id] = +input.value;
            out.textContent = fmt(ctl[c.id]);
            if (!running) redraw();
          });
          wrap.append(name, input, out);
          bar.appendChild(wrap);
        }
      }
      figure.appendChild(bar);
    }
    figure.appendChild(canvas);
    if (lab && (opts.metrics || []).length) {
      const box = document.createElement("div");
      box.className = "ds-metrics";
      metricEls = opts.metrics.map((m) => {
        const el = document.createElement("span");
        el.className = "ds-metric";
        const label = document.createElement("span");
        label.textContent = m.label;
        const val = document.createElement("b");
        el.append(label, val);
        box.appendChild(el);
        return { m, val };
      });
      figure.appendChild(box);
    }
    if (lab && opts.hint) {
      const h = document.createElement("div");
      h.className = "ds-hint";
      h.textContent = opts.hint;
      figure.appendChild(h);
    }
    let stepEls = null;
    let currentStep = -1;
    if (steps.length) {
      // 모든 캡션을 같은 칸에 겹쳐 두고 현재 단계만 보이게: 높이는 가장 긴 캡션 기준으로 고정
      const cap = document.createElement("figcaption");
      cap.className = "ds-steps";
      const dots = document.createElement("div");
      dots.className = "ds-step-dots";
      dots.setAttribute("aria-hidden", "true");
      const stack = document.createElement("div");
      stack.className = "ds-step-stack";
      const dotEls = steps.map(() => dots.appendChild(document.createElement("span")));
      const textEls = steps.map((_, i) => {
        const el = stack.appendChild(document.createElement("span"));
        el.textContent = stepLabel(i);
        return el;
      });
      cap.append(dots, stack);
      figure.appendChild(cap);
      stepEls = { dotEls, textEls };
    } else if (opts.caption) {
      const cap = document.createElement("figcaption");
      cap.textContent = opts.caption;
      figure.appendChild(cap);
    }
    host.appendChild(figure);
    if (FROZEN_T != null) document.documentElement.classList.add("ds-frozen");

    // ---- 차트 호버: 막대/점은 그 값, 선 그래프는 같은 x의 모든 시리즈 값 ----
    const tip = document.createElement("div");
    tip.className = "ds-tip";
    tip.hidden = true;
    const cross = document.createElement("div");
    cross.className = "ds-cross";
    cross.hidden = true;
    figure.append(cross, tip);

    const fmtXof = (c, v) => (c && c.xFormat ? c.xFormat(v) : typeof v === "number" ? compactNumber(v) : String(v));
    const fmtYof = (c, v) => (c && c.yFormat ? c.yFormat(v) : compactNumber(v));

    function hoverInfo(px, py) {
      const nodes = scene.nodes;
      for (const n of nodes) {
        const r = n.rect;
        if (n.type !== "bar" || !r) continue;
        if (px >= r.x - 2 && px <= r.x + r.w + 2 && py >= r.y - 6 && py <= r.y + r.h + 2) {
          const c = scene.byId.get(n.chartId);
          const v = n.raw ?? n.value;
          return { x: r.x + r.w / 2, y: r.y, title: fmtXof(c, n.key), rows: [{ label: n.seriesLabel, role: n.role, value: n.format ? n.format(v) : fmtYof(c, v) }] };
        }
      }
      let best = null;
      for (const n of nodes) {
        if (n.type !== "scatter") continue;
        n.pts.forEach((q, i) => {
          const d = Math.hypot(q[0] - px, q[1] - py);
          if (d < 14 && (!best || d < best.d)) best = { d, n, i, q };
        });
      }
      if (best) {
        const c = scene.byId.get(best.n.chartId);
        const [x, y] = best.n.points[best.i];
        return { x: best.q[0], y: best.q[1], title: fmtXof(c, x), rows: [{ label: best.n.label, role: best.n.role, value: fmtYof(c, y) }] };
      }
      for (const c of nodes) {
        if (c.type !== "axis") continue;
        const P = c.plot;
        if (px < P.x - 8 || px > P.x + P.w + 8 || py < P.y - 8 || py > P.y + P.h + 8) continue;
        const series = nodes.filter((n) => n.data && n.chartId === c.id && n.pts);
        if (!series.length) continue;
        let key = null;
        let kx = 0;
        let gapBest = Infinity;
        for (const sr of series)
          sr.data.forEach((d, i) => {
            const g = Math.abs(sr.dataPts[i][0] - px);
            if (g < gapBest) (gapBest = g), (key = d[0]), (kx = sr.dataPts[i][0]);
          });
        const rows = [];
        let topY = Infinity;
        for (const sr of series) {
          const i = sr.data.findIndex((d) => d[0] === key);
          if (i < 0) continue;
          rows.push({ label: sr.label, role: sr.role, value: fmtYof(c, sr.data[i][1]) });
          topY = Math.min(topY, sr.dataPts[i][1]);
        }
        return { x: kx, y: topY, title: fmtXof(c, key), rows, cross: { top: P.y, h: P.h } };
      }
      return null;
    }

    function showTip(e) {
      if (!scene || opts.hover === false) return;
      const box = canvas.getBoundingClientRect();
      const u = scene.unit;
      const px = (e.clientX - box.left) / u;
      const py = (e.clientY - box.top) / u - scene.offsetY;
      const info = hoverInfo(px, py);
      if (!info) return hideTip();
      tip.replaceChildren();
      const t = document.createElement("div");
      t.className = "ds-tip-title";
      t.textContent = info.title;
      tip.appendChild(t);
      for (const r of info.rows) {
        const row = document.createElement("div");
        row.className = "ds-tip-row";
        const sw = document.createElement("i");
        sw.style.background = `var(--ds-${["neutral", "muted"].includes(r.role) ? "muted" : r.role || "focus"})`;
        const label = document.createElement("span");
        label.textContent = r.label ? `${r.label}` : "";
        const val = document.createElement("b");
        val.textContent = r.value;
        row.append(sw, label, val);
        tip.appendChild(row);
      }
      tip.hidden = false;
      const left = canvas.offsetLeft + info.x * u;
      const top = canvas.offsetTop + (info.y + scene.offsetY) * u;
      const tw = tip.offsetWidth;
      const fw = figure.clientWidth;
      tip.style.left = `${Math.max(0, Math.min(fw - tw, left - tw / 2))}px`;
      tip.style.top = `${Math.max(0, top - tip.offsetHeight - 10)}px`;
      if (info.cross) {
        cross.hidden = false;
        cross.style.left = `${left}px`;
        cross.style.top = `${canvas.offsetTop + (info.cross.top + scene.offsetY) * u}px`;
        cross.style.height = `${info.cross.h * u}px`;
      } else cross.hidden = true;
    }
    function hideTip() {
      tip.hidden = true;
      cross.hidden = true;
    }
    canvas.addEventListener("pointermove", showTip);
    canvas.addEventListener("pointerdown", showTip);
    canvas.addEventListener("pointerleave", hideTip);

    function showStep(p) {
      if (!stepEls) return;
      let i = 0;
      steps.forEach((st, k) => {
        if (p + 1e-6 >= st.at) i = k;
      });
      if (i === currentStep) return;
      currentStep = i;
      stepEls.textEls.forEach((el, k) => el.classList.toggle("is-active", k === i));
      stepEls.dotEls.forEach((el, k) => {
        el.classList.toggle("is-active", k === i);
        el.classList.toggle("is-done", k < i);
      });
    }

    const ctx = canvas.getContext("2d");
    measureCtx = measureCtx || document.createElement("canvas").getContext("2d");
    let scene = null;
    const report = { name, issues: [] };
    reports.push(report);

    function layout(check = true) {
      const cw = Math.max(1, figure.clientWidth);
      const useMobile = opts.mobile && cw < MOBILE_BREAKPOINT;
      const designW = useMobile ? opts.mobile.width || 360 : opts.width || 640;
      const draw = useMobile ? opts.mobile.draw : opts.draw;
      const unit = cw / designW;
      measureCtx.setTransform(1, 0, 0, 1, 0, 0);
      const b = createBuilder(measureCtx, unit);
      try {
        if (lab) draw(b.g, sim, ctl);
        else draw(b.g);
      } catch (err) {
        b.errors.push(`draw 오류: ${err.message}`);
      }
      b.finalize();
      expandGroups(b);
      const bounds = sceneBounds(b.nodes);
      // 요소 위쪽 빈 공간을 잘라 위아래 여백 8로 통일
      let offsetY = opts.height ? 0 : 8 - bounds.minY;
      let designH = opts.height || bounds.maxY - bounds.minY + 16;
      if (lab) {
        // 시뮬레이션이 진행돼도 카드 높이가 흔들리지 않게 첫 프레임 기준, 더 커질 때만 늘림
        if (!labBase || labBase.cw !== cw) labBase = { offsetY, designH, cw };
        else if (!opts.height) labBase.designH = Math.max(labBase.designH, bounds.maxY + labBase.offsetY + 8);
        offsetY = labBase.offsetY;
        designH = labBase.designH;
      }
      if (check) {
        const result = validate(name + (useMobile ? " (mobile)" : ""), b, sequence, designW, designH);
        if (mode === "demo") result.issues.push(...validateSteps(steps, sequence));
        if (opts.stepsCheck) result.issues.push(...validateSteps(opts.stepsCheck, sequence));
        if (lab && !opts.init) result.issues.push("createLab에 init 없음");
        Object.assign(report, result);
        if (result.issues.length) console.warn(`[dsviz] ${result.name}`, result.issues);
      }
      // 실제 그리기용 builder: 같은 노드를 canvas ctx 기준으로 다시 사용
      const pb = { ...b, setFont: (s, w, m) => (ctx.font = `${w || 400} ${b.fontPx(s)}px ${m ? MONO : FONT}`) };
      scene = { b: pb, nodes: b.nodes, byId: b.byId, designW, designH, unit, cw, offsetY };
    }

    function paint(rawP, elapsed) {
      if (!scene) return;
      // 나눠 보기의 한 단계: 전체 진행률 중 range 구간만 재생
      const p = opts.range ? opts.range[0] + rawP * (opts.range[1] - opts.range[0]) : rawP;
      showStep(p);
      const dpr = global.devicePixelRatio || 1;
      const { cw, unit, designH } = scene;
      const ch = Math.ceil(designH * unit);
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
        canvas.style.width = `${cw}px`;
        canvas.style.height = `${ch}px`;
      }
      const tk = readTokens(host);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr * unit, 0, 0, dpr * unit, 0, scene.offsetY * dpr * unit);
      const states = nodeStates(scene.nodes, sequence, p);
      for (const n of scene.nodes) {
        const st = states.get(n.id);
        if (st.alpha <= 0) continue;
        if (st.tint < 1) {
          const grey = { ...n, role: n.type === "box" ? "neutral" : "muted" };
          paintNode(ctx, scene.b, tk, grey, { ...st, alpha: st.alpha * (1 - st.tint) }, elapsed);
        }
        if (st.tint > 0) paintNode(ctx, scene.b, tk, n, { ...st, alpha: st.alpha * st.tint }, elapsed);
      }
      // travel/pulse/cycle은 구간 안에서만, 마지막 프레임에는 그리지 않음
      if (rawP < 1) {
        for (const item of sequence) {
          if (!OVERLAY.has(item.effect) || p < item.from || p > item.to) continue;
          const n = scene.byId.get(item.id);
          if (!n) continue;
          const local = (p - item.from) / (item.to - item.from);
          paintOverlay(ctx, scene.b, tk, n, item, local, elapsed);
        }
      }
    }

    const reduceMotion = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = true;
    let raf = 0;
    let start = 0;

    let lastNow = 0;
    let lastMetric = 0;
    function resetSim() {
      sim = opts.init ? opts.init({ ...ctl }) : {};
      simTime = 0;
    }
    function updateMetrics(force) {
      if (!metricEls) return;
      const now = performance.now();
      if (!force && now - lastMetric < 100) return;
      lastMetric = now;
      const vals = opts.measure ? opts.measure(sim, ctl) : {};
      for (const { m, val } of metricEls) {
        const v = vals[m.id];
        val.textContent = v == null ? "-" : m.format ? m.format(v) : String(v);
      }
    }
    function redraw() {
      layout(false);
      paint(1, simTime);
      updateMetrics(true);
    }
    function setRunning(on) {
      running = on;
      if (runBtn) runBtn.textContent = runLabels[on ? 1 : 0];
      lastNow = 0;
      schedule();
    }
    // 내보내기/캡처용: 처음부터 고정 간격으로 ms까지 진행 (같은 입력이면 같은 프레임)
    function simulateTo(ms) {
      if (ms < simTime) resetSim();
      while (simTime + LAB_DT <= ms) {
        opts.step && opts.step(sim, LAB_DT, ctl);
        simTime += LAB_DT;
      }
    }

    function frame(now) {
      raf = 0;
      if (lab) {
        const dt = lastNow ? Math.min(50, now - lastNow) : LAB_DT;
        lastNow = now;
        opts.step && opts.step(sim, dt, ctl);
        simTime += dt;
        layout(false);
        paint(1, simTime);
        updateMetrics();
        schedule();
        return;
      }
      if (!start) start = now;
      const cycle = timing.play + timing.hold;
      const t = (now - start) % cycle;
      paint(Math.min(1, t / timing.play), now - start);
      schedule();
    }

    function schedule() {
      if (lab) {
        if (FROZEN_T != null) {
          simulateTo(FROZEN_T * (opts.exportMs || 6000));
          layout(true);
          paint(1, simTime);
          updateMetrics(true);
          return;
        }
        if (!running || !visible || document.hidden) {
          if (raf) cancelAnimationFrame(raf);
          raf = 0;
          lastNow = 0;
          redraw();
          return;
        }
        if (!raf) raf = requestAnimationFrame(frame);
        return;
      }
      const still = !animated || FROZEN_T != null || (reduceMotion && reduceMotion.matches) || !visible || document.hidden;
      if (still) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        paint(FROZEN_T != null ? FROZEN_T : 1, 0);
        return;
      }
      if (!raf) raf = requestAnimationFrame(frame);
    }

    function relayout() {
      layout();
      if (!raf) schedule();
    }

    if (lab) {
      resetSim();
      // 포인터 위치를 그림 좌표로 ctl.pointer에 전달
      if (opts.pointer) {
        const move = (e) => {
          if (!scene) return;
          const box = canvas.getBoundingClientRect();
          ctl.pointer = { x: (e.clientX - box.left) / scene.unit, y: (e.clientY - box.top) / scene.unit - scene.offsetY, inside: true };
          if (!running) redraw();
        };
        canvas.addEventListener("pointermove", move);
        canvas.addEventListener("pointerdown", move);
        canvas.addEventListener("pointerleave", () => {
          ctl.pointer = { ...(ctl.pointer || {}), inside: false };
          if (!running) redraw();
        });
      }
      if (opts.autoplay && !(reduceMotion && reduceMotion.matches)) running = true;
      if (runBtn) runBtn.textContent = runLabels[running ? 1 : 0];
    }
    layout();
    schedule();

    new ResizeObserver(() => {
      if (scene && Math.abs(figure.clientWidth - scene.cw) < 0.5) return;
      relayout();
    }).observe(figure);
    if ("IntersectionObserver" in global) {
      new IntersectionObserver(([e]) => {
        visible = e.isIntersecting;
        if (visible) start = 0;
        schedule();
      }).observe(host);
    }
    document.addEventListener("visibilitychange", schedule);
    reduceMotion && reduceMotion.addEventListener?.("change", schedule);
    // 테마 전환 시 정지 상태에서도 색 갱신
    global.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => !raf && schedule());
    new MutationObserver(() => !raf && schedule()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    // 웹폰트 로드 후 글자 폭이 바뀌므로 다시 배치
    document.fonts?.ready.then(relayout);
    global.addEventListener?.("beforeprint", () => paint(1, 0));

    const cycle = lab ? opts.exportMs || 6000 : timing.play + timing.hold;
    controllers.push({
      name,
      cycle,
      animated,
      play: lab ? cycle : timing.play,
      hold: lab ? 0 : timing.hold,
      seek: lab
        ? (ms) => {
            simulateTo(ms);
            layout(false);
            paint(1, simTime);
            updateMetrics(true);
          }
        : (ms) => paint(animated ? Math.min(1, (ms % cycle) / timing.play) : 1, ms),
    });

    return { relayout, report };
  }

  function validateSteps(steps, sequence) {
    const issues = [];
    if (steps.length < 2) issues.push("createDemo는 단계 2개 이상 (단계가 하나면 createDiagram)");
    if (steps.length && steps[0].at !== 0) issues.push("첫 단계 at은 0");
    steps.forEach((st, i) => {
      if (!st.caption) issues.push(`단계 ${i + 1} 캡션 없음`);
      if (i > 0 && !(st.at > steps[i - 1].at)) issues.push(`단계 at이 오름차순이 아님: 단계 ${i + 1}`);
      if (!(st.at >= 0 && st.at < 1)) issues.push(`단계 at은 0 이상 1 미만: 단계 ${i + 1}`);
      // 단계 구간 안에서 시작하는 효과가 하나도 없으면 캡션만 바뀌고 그림은 그대로
      const end = i + 1 < steps.length ? steps[i + 1].at : 1;
      if (!sequence.some((s) => s.from >= st.at - 1e-6 && s.from < end)) issues.push(`단계 ${i + 1}에서 시작하는 효과 없음 (캡션만 바뀜)`);
    });
    return issues;
  }

  const createDiagram = (host, opts) => createScene(host, opts, "diagram");
  // display: "carousel"(기본, 한 그림에서 단계가 넘어감) | "split"(단계마다 그림 하나씩 세로로)
  function createDemo(host, opts) {
    // 약하게/끄기는 캐러셀 없이 결론(마지막 단계) 캡션 하나
    if (opts.motion === "soft" || opts.motion === "off") {
      const { steps = [], display, ...rest } = opts;
      return createScene(host, { ...rest, caption: steps[steps.length - 1]?.caption }, "diagram");
    }
    if (opts.display !== "split") return createScene(host, opts, "demo");
    if (typeof host === "string") host = document.querySelector(host);
    const name = opts.name || host.id || `diagram-${reports.length + 1}`;
    const steps = opts.steps || [];
    const play = opts.timing?.play || 2600 * Math.max(1, steps.length);
    host.classList.add("ds-split");
    return steps.map((st, i) => {
      const end = i + 1 < steps.length ? steps[i + 1].at : 1;
      const el = host.appendChild(document.createElement("div"));
      const { steps: _, display, ...rest } = opts;
      return createScene(
        el,
        {
          ...rest,
          name: `${name}-${i + 1}`,
          caption: `${circled(i)} ${st.caption}`,
          range: [st.at, end],
          timing: { hold: HOLD_MS, ...(opts.timing || {}), play: Math.round(play * (end - st.at)) },
          stepsCheck: i === 0 ? steps : null,
        },
        "diagram",
      );
    });
  }
  const createLab = (host, opts) => createScene(host, opts, "lab");

  // 시뮬레이션용 결정적 난수 (같은 seed면 같은 순서): 캡처/내보내기 결과가 매번 같도록
  function rng(seed = 1) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  global.Dsviz = { createDiagram, createDemo, createLab, rng };
})(window);
