// 사용법: node capture.mjs <html 경로> [--out 폴더] [--t 0.33,0.66,1] [--widths 720,390] [--dark]
// 결과: 폭/진행률별 스크린샷 + 다이어그램별 검증 결과(글자 겹침/넘침, 잘못된 sequence, 콘솔 오류)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve, basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.startsWith("--"));
if (!file) {
  console.error("html 경로가 필요함");
  process.exit(2);
}
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const dark = args.includes("--dark");
const ts = opt("t", "0.33,0.66,1").split(",").map(Number);
const widths = opt("widths", "720,390").split(",").map(Number);
const out = resolve(opt("out", join(process.cwd(), "capture")));
mkdirSync(out, { recursive: true });

// playwright 전용 브라우저가 없으면 설치된 Chrome 사용
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const page = await browser.newPage({ colorScheme: dark ? "dark" : "light", deviceScaleFactor: 2 });
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(e.message));

const stem = basename(file, ".html");
const reports = {};
for (const w of widths) {
  await page.setViewportSize({ width: w, height: 200 }); // fullPage가 내용 높이만큼 늘어남
  for (const t of ts) {
    const url = `${pathToFileURL(resolve(file)).href}?t=${t}`;
    await page.goto(url, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const shot = join(out, `${stem}_w${w}_t${t}${dark ? "_dark" : ""}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    console.log(`캡처: ${shot}`);
    if (t === ts[ts.length - 1]) reports[w] = await page.evaluate(() => window.__dsvizReport || []);
  }
}
await browser.close();

let failed = false;
for (const [w, list] of Object.entries(reports)) {
  for (const r of list) {
    const status = r.issues?.length ? "FAIL" : "PASS";
    if (r.issues?.length) failed = true;
    console.log(`[${status}] w${w} ${r.name} (높이 ${r.height})`);
    for (const i of r.issues || []) console.log(`   - ${i}`);
  }
}
if (consoleErrors.length) {
  failed = true;
  console.log("콘솔 오류:");
  for (const e of [...new Set(consoleErrors)]) console.log(`   - ${e}`);
}
process.exit(failed ? 1 : 0);
