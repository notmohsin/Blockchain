// UI acceptance test (M5): the ROADMAP scenario driven through the browser (headless system Chromium, D-046).
// Requires: network-bft up (`./network.sh all`), gateway-v2 running on :4000 serving frontend-v2/dist.
//   node tests/ui-e2e.mjs [baseUrl]
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'http://localhost:4000';
const WE = path.resolve(here, '../../../outputs/worked-example/files');
const SHOTS = path.join(here, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const FIR = `${(Date.now() % 900000) + 1000}/2026`;
const results = [];
const check = (ok, what, extra = '') => { results.push(!!ok); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}${extra ? `  (${extra})` : ''}`); };
const exe = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
page.on('dialog', (d) => d.accept('Copy for defence counsel under court order'));
const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`), fullPage: true });

const NAMES = { 'io.sharma': 'Sharma', 'malkhana.desai': 'Desai', 'examiner.mehta': 'Mehta', 'clerk.rao': 'Rao' };
async function login(u) {
  if (await page.$('text=Sign out')) await page.click('text=Sign out');
  await page.waitForSelector('#u');
  await page.fill('#u', u); await page.fill('#p', 'custody-demo');
  await page.click('button[type=submit]');
  await page.waitForFunction((n) => document.querySelector('[data-testid=whoami]')?.textContent.includes(n), NAMES[u]);
}
async function openEvidence(id) {
  await page.goto(`${BASE}/#/evidence/${encodeURIComponent(id)}`);
  await page.waitForSelector('[data-testid=timeline]');
}
async function act(action, fill = async () => {}) {
  await page.click(`[data-action=${action}]`);
  await page.waitForSelector('[data-testid=action-form]');
  await fill();
  await page.click('[data-testid=action-submit]');
  await page.waitForSelector('[role=alert]', { timeout: 120000 });
  const err = await page.$('[role=alert].bg-bad-50, [role=alert] >> text=/./');
  return page.textContent('[role=alert]');
}
const timeline = () => page.$$eval('[data-testid=timeline] li', (els) => els.map((e) => e.dataset.event));

try {
  console.log(`CustodyChain UI scenario (FIR ${FIR}) against ${BASE}\n`);
  // ---------------------------------------------------------------- IO registers a photograph and a notebook
  await page.goto(`${BASE}/`);
  await page.fill('#u', 'io.sharma'); await page.fill('#p', 'wrong');
  await page.click('button[type=submit]');
  await page.waitForSelector('[role=alert]');
  check(/wrong username or password/.test(await page.textContent('[role=alert]')), 'wrong password shows an error');
  await shot('01-login');
  await login('io.sharma');
  check((await page.textContent('[data-testid=whoami]')).includes('Sharma'), 'IO signs in');

  async function commonFields(title) {
    await page.fill('#fir', FIR);
    await page.fill('#title', title);
    await page.fill('#ld', 'Office premises, room 2');
    await page.fill('#la', 'Plot 14, GIDC, Gandhinagar');
    await page.fill('#w1', 'R. Patel'); await page.fill('#w1a', 'Sector 21, Gandhinagar');
    await page.fill('#dm', 'Departmental smartphone (ICJS spec)');
  }
  await page.click('a[href="#/register"]');
  await page.click('[data-class=SCENE_PHOTOGRAPH]');
  await commonFields('Scene photograph: overall view of room 2');
  await page.fill('#subject', 'Knife near stain (marker 1)');
  await page.fill('#photo_series_id', `SOC-${FIR}`);
  await page.setInputFiles('[data-slot=photo]', path.join(WE, 'photo/IMG_0001.jpg'));
  await page.waitForSelector('[data-testid=register-form] code[data-hash]');
  await shot('02-register-photo-hashed-in-browser');
  await page.click('[data-testid=register-submit]');
  await page.waitForSelector('[data-testid=register-result], [role=alert]', { timeout: 120000 });
  const photoId = (await page.textContent('[data-testid=new-evidence-id]').catch(() => '')).trim();
  check(/^GJ-GNR-CYBPS-2026-\d{6}-E001$/.test(photoId), `photograph registered through the UI -> ${photoId}`);
  await shot('03-registered');

  await page.click('text=Register another item');
  await page.click('[data-class=PHYSICAL_DOCUMENT]');
  await commonFields("Spiral notebook 'ACCOUNTS 2026' from desk drawer");
  await page.fill('#seal', 'TEB-GJ-0007741');
  await page.fill('#document_type', 'spiral notebook');
  await page.fill('[id="dimensions_mm.width"]', '105');
  await page.fill('[id="dimensions_mm.height"]', '148');
  await page.fill('#binding', 'metal spiral, left edge');
  await page.fill('#distinguishing_features', 'ring stain on cover, corner of page 3 torn');
  await page.selectOption('#scan_colour_mode', 'GRAY-8');
  await page.setInputFiles('[data-slot=cover]', path.join(WE, 'notebook/cover.jpg'));
  await page.setInputFiles('[data-slot=pages]', [1, 2, 3, 4, 5, 6].map((p) => path.join(WE, `notebook/page_00${p}.png`)));
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=register-form] code[data-hash]').length >= 7);
  await page.click('[data-testid=register-submit]');
  await page.waitForSelector('[data-testid=register-result], [role=alert]', { timeout: 120000 });
  const nbId = (await page.textContent('[data-testid=new-evidence-id]').catch(() => '')).trim();
  check(/-E002$/.test(nbId), `notebook (cover + 6 page scans) registered through the UI -> ${nbId}`, nbId ? '' : await page.textContent('[role=alert]'));

  await openEvidence(nbId);
  check((await page.textContent('[data-testid=manifest-checks]')).includes('matches the ledger'), 'evidence page confirms the off-chain manifest matches the ledger');
  check((await page.$$('[data-testid=artefacts] li')).length === 7, 'evidence page lists 7 encrypted artefacts');
  let msg = await act('transfer', () => page.selectOption('#to', 'examiner.mehta').then(() => page.fill('#why', 'Forwarded to FSL, letter CPS/FSL/412/2026')));
  check(/Transfer initiated/.test(msg) && (await page.textContent('[data-testid=pending]')).includes('examiner.mehta'), 'IO initiates transfer to the FSL examiner', msg);
  await shot('04-transfer-pending');

  // ---------------------------------------------------------------- FSL examiner
  await login('examiner.mehta');
  check((await page.textContent('[data-testid=inbox-count]')).trim() === '1', 'examiner sees 1 incoming transfer');
  await openEvidence(nbId);
  msg = await act('accept', () => page.fill('#why', 'Received at FSL evidence counter'));
  check(/accepted/.test(msg) && (await page.textContent('[data-testid=custodian]')).includes('examiner.mehta'), 'examiner accepts custody (seal pre-filled and confirmed)', msg);
  msg = await act('identity', async () => {
    await page.fill('#sc', '4');
    await page.setInputFiles('#qf', path.join(WE, 'notebook/fsl_rescan/page_001.png'));
    await page.fill('#why', 'Identity check on receipt: re-scan compared with reference scans');
  });
  check(/Identity verified/.test(msg), 'examiner records an identity check (re-scan hashed in the browser)', msg);
  msg = await act('exam-start', () => page.fill('#why', 'Questioned-document examination begins'));
  check(/Examination started/.test(msg), 'examiner starts the examination (own reason)', msg);
  fs.writeFileSync(path.join(SHOTS, 'fsl-report.txt'), `FSL report on ${nbId}: entries consistent with a single writer.`);
  msg = await act('exam-end', async () => { await page.setInputFiles('#rf', path.join(SHOTS, 'fsl-report.txt')); await page.fill('#why', 'Examination complete, report FSL/QD/2026/913'); });
  check(/Examination completed/.test(msg), 'examiner completes the examination with the report hash attached', msg);
  msg = await act('transfer', () => page.selectOption('#to', 'clerk.rao').then(() => page.fill('#why', 'Sent to court with FSL report')));
  check(/Transfer initiated/.test(msg), 'examiner sends the notebook to the court clerk', msg);
  await shot('05-fsl-timeline');

  // ---------------------------------------------------------------- Court clerk
  await login('clerk.rao');
  await openEvidence(nbId);
  msg = await act('accept', () => page.fill('#why', 'Received in court property room'));
  check(/accepted/.test(msg), 'court clerk accepts custody', msg);
  msg = await act('court', () => page.fill('#ex', 'Article 4').then(() => page.fill('#why', 'Marked as Article 4')));
  check(/Submitted in court/.test(msg), 'court clerk records the court submission', msg);
  await page.setInputFiles('[data-testid=verify-input]', path.join(WE, 'notebook/page_004.png'));
  await page.waitForSelector('[data-testid=verify-result]', { timeout: 120000 });
  check((await page.getAttribute('[data-testid=verify-result]', 'data-result')) === 'MATCH', 'court verifies page 4 on the evidence page: MATCH');
  const tl = await timeline();
  const reasons = await page.$$eval('[data-testid=timeline] li', (els) => els.map((e) => e.querySelector('.text-ink-600')?.textContent));
  check(new Set(reasons).size === reasons.length || reasons.filter((r) => /Identity check/.test(r)).length === 1, 'each event keeps its own reason (no stale form text)');
  const want = ['REGISTER', 'TRANSFER_INITIATE', 'TRANSFER_ACCEPT', 'VERIFY_IDENTITY', 'EXAMINE_START', 'EXAMINE_END', 'TRANSFER_INITIATE', 'TRANSFER_ACCEPT', 'SUBMIT_COURT', 'VERIFY_INTEGRITY'];
  check(JSON.stringify(tl) === JSON.stringify(want), `timeline shows the full chain (${tl.length} events)`, tl.join(' > '));
  await shot('06-court-evidence-page');

  await page.goto(`${BASE}/#/verify/${encodeURIComponent(photoId)}`);
  await page.setInputFiles('#vf', path.join(WE, 'photo/IMG_0001_knife_removed.jpg'));
  await page.click('form button[type=submit]');
  await page.waitForSelector('[data-testid=verify-page-result]', { timeout: 120000 });
  check((await page.getAttribute('[data-testid=verify-page-result]', 'data-result')) === 'NO_MATCH', 'verify page: tampered photograph -> NO MATCH');
  await shot('07-verify-tampered');
  await page.setInputFiles('#vf', path.join(WE, 'photo/IMG_0001.jpg'));
  await page.click('form button[type=submit]');
  await page.waitForSelector('[data-testid=verify-page-result][data-result=MATCH]', { timeout: 120000 });
  check(true, 'verify page: original photograph -> MATCH');

  // ---------------------------------------------------------------- permissions visible in the UI
  await openEvidence(nbId);
  check(!(await page.$('[data-action=transfer]')) === false, 'custodian (clerk) sees the transfer action');
  await login('io.sharma');
  await openEvidence(nbId);
  check(!(await page.$('[data-action=transfer]')) && !(await page.$('[data-action=seal]')), 'non-custodian (IO) sees no custody actions, only verification');
  check(!(await page.$('a[href="#/register"]')) === false, 'IO sees "Register evidence"');
  await login('examiner.mehta');
  check(!(await page.$('a[href="#/register"]')), 'examiner does not see "Register evidence"');
} catch (e) {
  console.error(e);
  results.push(false);
  await shot('99-failure').catch(() => {});
} finally {
  await browser.close();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} UI checks passed${failed ? `, ${failed} FAILED` : ''}; screenshots in ${SHOTS}`);
process.exit(failed ? 1 : 0);
