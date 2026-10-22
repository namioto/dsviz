// 사용법: node export.mjs <html 경로> [--out 폴더] [--fps 20] [--no-caption] [--gif] [--width 960]
//        node export.mjs --check   (내보내기가 실패했을 때: 환경 점검과 설치 안내)
// 결과: 다이어그램마다 <html 이름>_<id>.webp (색 128개 무손실, 한 주기 반복) + _<id>.png (마지막 프레임)
// 4배 해상도(카드 폭 688 → 2752px)로 찍음: Confluence는 원본 폭의 절반을 내려보내서, 2752px를 올려야
// 1376px를 받아 레티나 578~808px 표시에서도 선명함
// 인코딩 방식은 환경을 감지해 고름:
//   pipe   : WebP 인코더(libwebp_anim)가 있는 ffmpeg에 찍은 화면을 바로 흘려보냄. 임시 파일 없음
//            찾는 순서: DSVIZ_FFMPEG 환경변수, PATH의 ffmpeg, Homebrew ffmpeg-full 설치 위치(링크가 풀린 경우)
//   frames : ffmpeg에 WebP 인코더가 없으면 임시 PNG 프레임을 img2webp로 묶음(끝나면 삭제)
// 프레임 순서: 완성된 그림을 hold(최소 3초) 동안 먼저 보여준 뒤 처음부터 그림. 첫 프레임만 보여주는 곳
// (앱, 미리보기, PDF)에서도 완성된 그림이 보이고, 반복할 때마다 완성 상태가 hold만큼 유지됨
// 캡션은 그림과 한 덩어리로 기본 포함. --no-caption이면 제외
// --gif: 같은 프레임으로 GIF도 만듦(128색, --width 폭으로 축소). WebP를 못 쓰는 곳용
import { chromium } from "playwright";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";

function run(cmd, a) {
  try {
    return execFileSync(cmd, a, { stdio: ["ignore", "pipe", "ignore"] }).toString();
  } catch {
    return null;
  }
}

const FFMPEG_CANDIDATES = [process.env.DSVIZ_FFMPEG, "ffmpeg", "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg", "/usr/local/opt/ffmpeg-full/bin/ffmpeg"].filter(Boolean);

function detect() {
  let ffmpeg = null;
  let ffmpegWebp = null;
  for (const bin of FFMPEG_CANDIDATES) {
    const enc = run(bin, ["-hide_banner", "-encoders"]);
    if (enc == null) continue;
    ffmpeg ||= bin;
    if (enc.includes("libwebp_anim")) {
      ffmpegWebp = bin;
      break;
    }
  }
  return { ffmpeg, ffmpegWebp, img2webp: run("img2webp", ["-version"]) != null };
}

const env = detect();
// 기본 ffmpeg에는 WebP 인코더가 없음. ffmpeg-full은 미리 빌드된 파일이 있고 기본 ffmpeg 기능을 포함
const INSTALL_PIPE = "brew install ffmpeg-full";
const mode = env.ffmpegWebp ? "pipe" : env.img2webp ? "frames" : null;

const args = process.argv.slice(2);
if (args.includes("--check")) {
  console.log(`ffmpeg: ${env.ffmpeg || "없음"} / WebP 인코더 있는 ffmpeg: ${env.ffmpegWebp || "없음"} / img2webp: ${env.img2webp ? "있음" : "없음"}`);
  if (mode === "pipe") console.log("방식: pipe (임시 파일 없음). 준비 완료");
  else if (mode === "frames") console.log(`방식: frames (임시 PNG 사용). 임시 파일 없이 만들려면 설치:\n  ${INSTALL_PIPE}`);
  else console.log(`내보낼 수 없음. 설치:\n  ${INSTALL_PIPE}`);
  process.exit(mode ? 0 : 2);
}

const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const valued = new Set(["out", "fps", "width"]);
const file = args.find((a, i) => !a.startsWith("--") && !valued.has(args[i - 1]?.replace(/^--/, "")));
if (!file) {
  console.error("html 경로가 필요함");
  process.exit(2);
}
const fps = Number(opt("fps", 20));
const outWidth = Number(opt("width", 960));
const withCaption = !args.includes("--no-caption");
const withGif = args.includes("--gif");
const SCALE = 4;
const MIN_HOLD_MS = 3000;
const out = resolve(opt("out", join(process.cwd(), "export")));

if (!mode) {
  console.error(`WebP 인코더가 없어 내보낼 수 없음. 설치한 뒤 다시 실행:\n  ${INSTALL_PIPE}`);
  process.exit(2);
}
if (withGif && !env.ffmpeg) {
  console.error("--gif에는 ffmpeg가 필요함 (brew install ffmpeg-full 또는 brew install ffmpeg)");
  process.exit(2);
}
mkdirSync(out, { recursive: true });

// 프레임 전체에서 공통 팔레트를 뽑고, 글자 가장자리가 지저분해지지 않게 디더링 없이 적용
const GIF_FILTER = `scale=${outWidth}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=none`;
// 무손실, 찍은 해상도 그대로: 줄이면 중간색이 생겨 오히려 커지고 흐려짐
// 정해진 색만 쓰는 그림이라 공통 색 128개로 줄여도 구분되지 않고 용량은 약 20~40% 감소. 디더링은 글자 가장자리를 지저분하게 해서 제외
const PALETTE_FILTER = "split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=none";
const WEBP_ARGS = ["-c:v", "libwebp_anim", "-lossless", "1", "-compression_level", "4", "-loop", "0"];

const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
// 720 폭 = 데스크톱 배치
const page = await browser.newPage({ viewport: { width: 720, height: 400 }, deviceScaleFactor: SCALE, colorScheme: "light" });
await page.goto(`${pathToFileURL(resolve(file)).href}?t=1`, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
if (!withCaption) await page.addStyleTag({ content: ".ds-figure figcaption { display: none !important; }" });
await page.waitForTimeout(200);

const cycles = await page.evaluate(() => window.__dsvizCycles());
const cards = page.locator(".ds-card");
const stem = basename(file, ".html");

// 찍을 시각 목록(ms): 앞부분은 완성 상태(play 이후 시각), 뒤는 0부터 play 직전까지
function frameTimes({ play, hold }) {
  const step = 1000 / fps;
  const holdFrames = Math.round((Math.max(hold, MIN_HOLD_MS) / 1000) * fps);
  const playFrames = Math.round((play / 1000) * fps);
  // 완성 상태 시각은 대본의 hold 안에서만 돌림: hold를 넘기면 런타임이 다음 주기로 보고 처음부터 다시 그림
  return [...Array.from({ length: holdFrames }, (_, k) => play + ((k * step) % hold)), ...Array.from({ length: playFrames }, (_, k) => k * step)];
}

// pipe: 찍은 PNG를 ffmpeg 표준 입력으로 바로 전달 (WebP와 GIF를 한 번에)
async function encodePipe(card, times, webp, gif) {
  const a = ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-", "-vf", PALETTE_FILTER, ...WEBP_ARGS, webp];
  if (gif) a.push("-vf", GIF_FILTER, "-c:v", "gif", "-loop", "0", gif);
  const ff = spawn(env.ffmpegWebp, a, { stdio: ["pipe", "ignore", "inherit"] });
  const done = new Promise((res, rej) => ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg 종료 코드 ${c}`)))));
  for (const ms of times) {
    await page.evaluate((t) => window.__dsvizSeek(t), ms);
    const buf = await card.screenshot();
    if (!ff.stdin.write(buf)) await once(ff.stdin, "drain");
  }
  ff.stdin.end();
  await done;
}

// frames: 임시 폴더에 PNG를 쓰고 img2webp로 묶은 뒤 삭제
async function encodeFrames(card, times, webp, gif) {
  const tmp = mkdtempSync(join(tmpdir(), "dsviz-"));
  try {
    const raw = [];
    for (const [f, ms] of times.entries()) {
      await page.evaluate((t) => window.__dsvizSeek(t), ms);
      const p = join(tmp, `f${String(f).padStart(4, "0")}.png`);
      await card.screenshot({ path: p });
      raw.push(p);
    }
    // ffmpeg가 있으면 pipe와 같은 색 128개로 줄인 프레임을 묶음
    let frames = raw;
    if (env.ffmpeg) {
      execFileSync(env.ffmpeg, ["-y", "-loglevel", "error", "-i", join(tmp, "f%04d.png"), "-vf", PALETTE_FILTER, "-start_number", "0", join(tmp, "q%04d.png")]);
      frames = raw.map((p) => p.replace(/f(\d{4})\.png$/, "q$1.png"));
    }
    execFileSync("img2webp", ["-loop", "0", "-lossless", "-q", "75", "-m", "4", "-d", String(Math.round(1000 / fps)), ...frames, "-o", webp], { stdio: "ignore" });
    if (gif) execFileSync(env.ffmpeg, ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", join(tmp, "f%04d.png"), "-vf", GIF_FILTER, "-loop", "0", gif]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

for (let i = 0; i < cycles.length; i++) {
  const { name, cycle, animated, play, hold } = cycles[i];
  const card = cards.nth(i);
  await card.scrollIntoViewIfNeeded();
  const safe = name.replace(/[^\w가-힣-]+/g, "_");

  await page.evaluate((ms) => window.__dsvizSeek(ms), cycle - 1);
  const png = join(out, `${stem}_${safe}.png`);
  await card.screenshot({ path: png });

  if (!animated) {
    console.log(`PNG만: ${png} (애니메이션 없음)`);
    continue;
  }

  // 실험(lab)과 약하게(motion: "soft")는 멈춤 없이 처음부터 그대로 찍음 (약하게는 첫 프레임이 이미 완성 그림)
  const times = hold > 0 ? frameTimes({ play, hold }) : Array.from({ length: Math.round((cycle / 1000) * fps) }, (_, k) => (k * 1000) / fps);
  const webp = join(out, `${stem}_${safe}.webp`);
  const gif = withGif ? join(out, `${stem}_${safe}.gif`) : null;
  await (mode === "pipe" ? encodePipe : encodeFrames)(card, times, webp, gif);
  console.log(`WebP: ${webp} (${times.length}프레임 ${(times.length / fps).toFixed(1)}초, ${Math.round(statSync(webp).size / 1024)}KB, ${mode})`);
  if (gif) console.log(`GIF: ${gif} (${Math.round(statSync(gif).size / 1024)}KB)`);
}

await browser.close();
