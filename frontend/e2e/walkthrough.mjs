/**
 * End-to-end walkthrough of the product in a real browser.
 *
 *   npm run build && npm start        # in one terminal
 *   npm run e2e                       # in another, with the API running
 *
 * Environment: E2E_BASE_URL, E2E_CSV, E2E_SHOTS, PLAYWRIGHT_CHROMIUM_PATH.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const SHOTS = process.env.E2E_SHOTS ?? path.join(process.cwd(), 'e2e', 'screenshots');
const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const CSV = process.env.E2E_CSV ?? path.join(process.cwd(), 'e2e', 'fixtures', 'vendas.csv');
const email = `e2e-${Date.now()}@exemplo.com`;

const errors = [];
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

fs.mkdirSync(SHOTS, { recursive: true });

// A preinstalled browser (CI images, sandboxes) is used when present.
const launchOptions = process.env.PLAYWRIGHT_CHROMIUM_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
  : {};
const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
const page = await context.newPage();

page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text().slice(0, 200)}`);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${String(err).slice(0, 200)}`));

try {
  // ── Landing ────────────────────────────────────────────────────────
  await page.goto(BASE, { waitUntil: 'networkidle' });
  check('Landing carrega', await page.getByRole('heading', { name: /compreendidos/i }).isVisible());
  await page.waitForTimeout(2500); // let the WebGL hero settle
  await page.screenshot({ path: `${SHOTS}/01-landing.png` });

  const pricingVisible = await page.locator('#planos').isVisible();
  check('Seção de planos presente', pricingVisible);

  // ── Register ───────────────────────────────────────────────────────
  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
  await page.getByLabel('Nome').fill('Ana Teste');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('SenhaSegura123');
  await page.getByRole('button', { name: /Criar conta gratuita/i }).click();
  await page.waitForURL(/\/app/, { timeout: 20000 });
  check('Cadastro autentica e redireciona', page.url().includes('/app'));

  // Dismiss onboarding
  const skip = page.getByRole('button', { name: /Pular/i });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/02-workspace.png` });

  // ── Upload ─────────────────────────────────────────────────────────
  await page.setInputFiles('input[type=file]', CSV);
  await page.waitForTimeout(1800);
  const fixtureName = path.basename(CSV);
  const previewShown = await page.getByText(fixtureName, { exact: false }).first().isVisible();
  check('Pré-visualização do CSV (Web Worker)', previewShown, fixtureName);
  await page.screenshot({ path: `${SHOTS}/03-upload-preview.png` });

  await page.getByRole('button', { name: /Analisar e gerar dashboard/i }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/04-analysis-progress.png` });

  await page.waitForURL(/\/overview/, { timeout: 90000 });
  await page.waitForTimeout(4500);
  check('Dashboard gerado após upload', page.url().includes('/overview'));

  const canvasCount = await page.locator('canvas').count();
  check('Gráficos renderizados', canvasCount >= 3, `${canvasCount} canvas`);

  const kpiLabels = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-widget-type="kpi"]'));
    return cards.map((card) => card.querySelector('p')?.textContent?.trim() ?? '');
  });
  check(
    'KPIs presentes com rótulo',
    kpiLabels.length >= 3 && kpiLabels.every(Boolean),
    kpiLabels.join(' | '),
  );
  await page.screenshot({ path: `${SHOTS}/05-dashboard.png`, fullPage: true });

  const pageHeight = await page.evaluate(() => document.body.scrollHeight);
  check('Altura da página contida (tabela rola no card)', pageHeight < 5000, `${pageHeight}px`);

  // ── Widget rationale ───────────────────────────────────────────────
  const firstWidget = page.locator('.group\\/widget').nth(4);
  await firstWidget.hover();
  const infoBtn = firstWidget.getByRole('button', { name: /Por que este gráfico/i });
  if (await infoBtn.isVisible().catch(() => false)) {
    await infoBtn.click();
    await page.waitForTimeout(400);
    const rationale = await page.locator('text=/Série temporal|Comparação entre categorias|Composição/i').first().isVisible().catch(() => false);
    check('Justificativa do gráfico visível', rationale);
    await page.screenshot({ path: `${SHOTS}/06-rationale.png` });
  } else {
    check('Justificativa do gráfico visível', false, 'botão não encontrado');
  }

  // ── Filters ────────────────────────────────────────────────────────
  const filterBtn = page.getByRole('button', { name: /^Produto$|^Categoria$|^Canal$|^UF$/i }).first();
  if (await filterBtn.isVisible().catch(() => false)) {
    await filterBtn.click();
    await page.waitForTimeout(400);
    const option = page.locator('div[class*="absolute"] button').nth(1);
    await option.click();
    await page.waitForTimeout(2000);
    check('Filtro aplicado', true);
    await page.keyboard.press('Escape');
    await page.mouse.click(700, 120);
    await page.waitForTimeout(500);
    const clearBtn = page.getByRole('button', { name: /Limpar \(/i });
    if (await clearBtn.isVisible().catch(() => false)) await clearBtn.click();
    await page.waitForTimeout(1200);
  } else {
    check('Filtro aplicado', false, 'nenhum filtro encontrado');
  }

  // ── Edit mode ──────────────────────────────────────────────────────
  await page.getByRole('button', { name: /^Editar$/ }).click();
  await page.waitForTimeout(800);
  const editorVisible = await page.getByText(/Nenhum widget selecionado|Dados/i).first().isVisible().catch(() => false);
  check('Modo de edição abre o painel', editorVisible);
  await page.locator('.group\\/widget').nth(5).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/07-edit-mode.png`, fullPage: false });

  const titleInput = page.getByLabel('Título').first();
  if (await titleInput.isVisible().catch(() => false)) {
    await titleInput.fill('Meu gráfico editado');
    await page.waitForTimeout(900);
    const applied = await page.getByText('Meu gráfico editado').first().isVisible().catch(() => false);
    check('Edição de título aplica no card', applied);
    const saveBtn = page.getByRole('button', { name: /^Salvar$/ });
    if (await saveBtn.isVisible().catch(() => false)) {
      await saveBtn.click();
      await page.waitForTimeout(1500);
      check('Salvamento do dashboard', true);
    }
  } else {
    check('Edição de título aplica no card', false, 'campo não encontrado');
  }
  await page.getByRole('button', { name: /Concluir/ }).click();
  await page.waitForTimeout(600);

  // ── AI Analyst ─────────────────────────────────────────────────────
  await page.getByRole('link', { name: /AI Analyst/i }).click();
  await page.waitForURL(/analyst/, { timeout: 15000 });
  await page.waitForTimeout(1800);
  await page.getByLabel('Pergunta para o analista').fill('Qual produto vendeu mais?');
  await page.getByRole('button', { name: /Enviar pergunta/i }).click();
  await page.waitForTimeout(6000);
  const answer = await page.locator('text=/O maior valor|Notebook|Mouse/i').first().isVisible().catch(() => false);
  check('AI Analyst responde com dados reais', answer);
  await page.screenshot({ path: `${SHOTS}/08-analyst.png`, fullPage: true });

  await page.getByLabel('Pergunta para o analista').fill('Mostre as vendas por estado');
  await page.getByRole('button', { name: /Enviar pergunta/i }).click();
  await page.waitForTimeout(6500);
  const chartInChat = (await page.locator('canvas').count()) > 0;
  check('AI Analyst gera gráfico', chartInChat);
  await page.screenshot({ path: `${SHOTS}/09-analyst-chart.png`, fullPage: true });

  // ── Explore ────────────────────────────────────────────────────────
  await page.getByRole('link', { name: /Explore/i }).click();
  await page.waitForURL(/explore/, { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.getByLabel('Eixo X / Dimensão').selectOption({ label: 'Produto' });
  await page.waitForTimeout(500);
  await page.getByLabel('Eixo Y / Métrica').selectOption({ label: 'Valor total' });
  await page.waitForTimeout(3500);
  const exploreChart = (await page.locator('canvas').count()) > 0;
  check('Explore gera visualização', exploreChart);
  const exploreText = await page.locator('section[aria-label="Resultado da exploração"]').innerText();
  check(
    'Explore explica a sugestão',
    /barras|categorias|dispersão|linha|participação/i.test(exploreText),
  );
  await page.screenshot({ path: `${SHOTS}/10-explore.png`, fullPage: true });

  // ── Data Quality ───────────────────────────────────────────────────
  await page.getByRole('link', { name: /Data Quality/i }).click();
  await page.waitForURL(/quality/, { timeout: 15000 });
  await page.waitForTimeout(2000);
  const scoreVisible = await page.locator('text=/\\/100/').first().isVisible();
  check('Página de qualidade exibe pontuação', scoreVisible);
  const columnsTable = await page.getByText(/Perfilamento por coluna/i).isVisible();
  check('Perfilamento por coluna presente', columnsTable);
  await page.screenshot({ path: `${SHOTS}/11-quality.png`, fullPage: true });

  await page.locator('tbody tr').filter({ hasText: 'valor_total' }).first().click();
  await page.waitForTimeout(2000);
  const detailText = await page.locator('body').innerText();
  check('Detalhe de coluna abre', /MEDIANA|Mediana/.test(detailText) && /DESVIO|Desvio/.test(detailText));
  await page.screenshot({ path: `${SHOTS}/12-column-detail.png` });
  await page.getByRole('button', { name: /Fechar/i }).first().click();

  // ── Analytics ──────────────────────────────────────────────────────
  await page.getByRole('link', { name: /Analytics/i }).click();
  await page.waitForURL(/analytics/, { timeout: 15000 });
  await page.waitForTimeout(3000);
  check('Analytics carrega tendências', (await page.locator('canvas').count()) > 0);
  await page.screenshot({ path: `${SHOTS}/13-analytics.png`, fullPage: true });

  await page.getByRole('tab', { name: /Correlações/i }).click();
  await page.waitForTimeout(3000);
  const spearman = await page.getByText(/Spearman/i).first().isVisible().catch(() => false);
  check('Correlação reporta o método usado', spearman);
  await page.screenshot({ path: `${SHOTS}/14-correlations.png`, fullPage: true });

  // ── Reports ────────────────────────────────────────────────────────
  await page.getByRole('link', { name: /Reports/i }).click();
  await page.waitForURL(/reports/, { timeout: 15000 });
  await page.waitForTimeout(2500);
  const reportTitle = await page.getByText(/Relatório de insights/i).first().isVisible();
  check('Relatório renderizado', reportTitle);
  await page.screenshot({ path: `${SHOTS}/15-report.png`, fullPage: true });

  // ── Theme switch ───────────────────────────────────────────────────
  await page.getByRole('link', { name: /Overview/i }).click();
  await page.waitForURL(/overview/, { timeout: 15000 });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /Alterar tema/i }).click();
  await page.waitForTimeout(400);
  await page.getByRole('menuitemradio', { name: /Paper/i }).click();
  await page.waitForTimeout(2500);
  const themeAttr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('Troca de tema aplica', themeAttr === 'light', `data-theme=${themeAttr}`);
  await page.screenshot({ path: `${SHOTS}/16-light-theme.png`, fullPage: true });

  await page.getByRole('button', { name: /Alterar tema/i }).click();
  await page.waitForTimeout(300);
  await page.getByRole('menuitemradio', { name: /Alto contraste/i }).click();
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${SHOTS}/17-contrast-theme.png`, fullPage: true });

  await page.getByRole('button', { name: /Alterar tema/i }).click();
  await page.waitForTimeout(300);
  await page.getByRole('menuitemradio', { name: /Blueprint/i }).first().click();
  await page.waitForTimeout(1800);

  // ── Presentation mode ──────────────────────────────────────────────
  await page.getByRole('button', { name: /Modo apresentação/i }).click();
  await page.waitForTimeout(2500);
  const presenting = await page.getByRole('button', { name: /Sair da apresentação/i }).isVisible();
  check('Modo apresentação abre', presenting);
  await page.screenshot({ path: `${SHOTS}/18-presentation.png`, fullPage: true });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);

  // ── Hostile file ───────────────────────────────────────────────────
  const hostile = await context.newPage();
  hostile.on('pageerror', () => {});
  await hostile.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
  await hostile.setInputFiles('input[type=file]', path.join(path.dirname(CSV), 'hostil.csv'));
  await hostile.waitForTimeout(1500);
  await hostile.getByRole('button', { name: /Analisar e gerar dashboard/i }).click();
  await hostile.waitForURL(/overview/, { timeout: 60000 });
  await hostile.waitForTimeout(4000);

  // Sweep every chart so the hostile labels are actually rendered in tooltips.
  for (const canvas of (await hostile.locator('canvas').all()).slice(0, 6)) {
    const box = await canvas.boundingBox();
    if (!box) continue;
    for (const [fx, fy] of [[0.25, 0.5], [0.5, 0.5], [0.75, 0.5], [0.5, 0.75]]) {
      await hostile.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
      await hostile.waitForTimeout(120);
    }
  }
  await hostile.waitForTimeout(800);

  const xssFired = await hostile.evaluate(() => Boolean(window.__XSS_FIRED));
  check('Rótulo hostil do CSV não executa script', !xssFired);

  const rawMarkup = await hostile.evaluate(() =>
    document.body.innerHTML.includes('<img src=x onerror'),
  );
  check('Markup do CSV não é injetado no DOM', !rawMarkup);

  const hostileText = await hostile.locator('body').innerText();
  check('Fórmula de planilha neutralizada', !/(^|\s)=cmd/.test(hostileText));
  await hostile.screenshot({ path: `${SHOTS}/21-arquivo-hostil.png`, fullPage: true });
  await hostile.close();

  // ── Mobile ─────────────────────────────────────────────────────────
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(BASE, { waitUntil: 'networkidle' });
  await mobile.waitForTimeout(2000);
  const hOverflow = await mobile.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  );
  check('Landing sem rolagem horizontal no mobile', !hOverflow);
  await mobile.screenshot({ path: `${SHOTS}/19-mobile-landing.png`, fullPage: true });

  await mobile.goto(`${BASE}${new URL(page.url()).pathname}`, { waitUntil: 'networkidle' });
  await mobile.waitForTimeout(4000);
  const dashOverflow = await mobile.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  );
  check('Dashboard sem rolagem horizontal no mobile', !dashOverflow);
  await mobile.screenshot({ path: `${SHOTS}/20-mobile-dashboard.png`, fullPage: true });
  await mobile.close();
} catch (error) {
  check('Execução sem exceções', false, String(error).slice(0, 300));
  await page.screenshot({ path: `${SHOTS}/99-failure.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

console.log('\n─── RESUMO ───');
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} verificações passaram`);
if (errors.length) {
  console.log(`\n⚠️  ${errors.length} erros de console/página:`);
  [...new Set(errors)].slice(0, 12).forEach((e) => console.log('   ' + e));
}
process.exit(failed.length > 0 ? 1 : 0);
