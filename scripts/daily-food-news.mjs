/**
 * daily-food-news.mjs
 * 毎朝 Gemini API でニュースを収集し、HTML を生成 → surge にデプロイ → Teams に投稿する
 *
 * 必要な環境変数:
 *   GEMINI_API_KEY    - Google AI Studio で発行したAPIキー
 *   SURGE_TOKEN       - `npx surge token` で取得したトークン
 *   TEAMS_WEBHOOK_URL - Teams チャンネルの Incoming Webhook URL
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── 1. 日付 ────────────────────────────────────────────────
const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
const yyyy = now.getFullYear();
const mm   = String(now.getMonth() + 1).padStart(2, '0');
const dd   = String(now.getDate()).padStart(2, '0');
const dateLabel = `${yyyy}年${mm}月${dd}日`;
const slug      = `foodnews${yyyy}${mm}${dd}`;
const domain    = `diagram-${slug}.surge.sh`;
const url       = `https://${domain}`;

// ─── 2. Gemini でニュース収集 ──────────────────────────────
async function fetchNews() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    tools: [{ googleSearch: {} }],
  });

  const prompt = `
今日（${dateLabel}）の日本の食品業界ニュースを、量販店（スーパー・ドラッグストアなど）と外食業界を中心に最新5本調べてください。

以下のJSON形式のみで回答してください（説明文・コードブロック記号は不要）:
{
  "news": [
    {
      "category": "量販店" または "外食",
      "headline": "30文字以内の見出し",
      "summary": "ニュースの内容を2〜3文で要約（数字・社名・具体的な背景を含める）",
      "source": "出典メディア名",
      "source_url": "記事のURL（わからなければ空文字）"
    }
  ]
}
  `.trim();

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();

  // JSON部分だけ抽出（```json ... ``` があっても対応）
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('GeminiからのレスポンスにJSONが含まれていません:\n' + text);
  return JSON.parse(jsonMatch[0]);
}

// ─── 3. HTML 生成 ──────────────────────────────────────────
function buildHtml(newsData) {
  const baseHtml = fs.readFileSync(
    path.join(ROOT, '.claude/skills/creating-visual-explainers/references/base.html'),
    'utf-8'
  );

  const cards = newsData.news.map((item, i) => {
    const isRetail  = item.category === '量販店';
    const borderCls = isRetail ? 'border-ads-accent' : 'border-emerald-500';
    const badgeCls  = isRetail
      ? 'bg-ads-accent/10 text-ads-accent-light'
      : 'bg-emerald-500/10 text-emerald-700';
    const icon = isRetail ? 'shopping-cart' : 'utensils';
    const sourceLink = item.source_url
      ? `<a href="${item.source_url}" target="_blank" rel="noopener" class="text-xs text-ads-dim hover:text-ads-accent transition-colors">出典: ${item.source}</a>`
      : `<span class="text-xs text-ads-dim">出典: ${item.source}</span>`;

    return `
  <!-- ニュース${i + 1} -->
  <div class="bg-ads-surface border border-ads-border rounded-xl overflow-hidden">
    <div class="border-l-4 ${borderCls} px-5 py-4">
      <div class="flex items-center gap-2 mb-2">
        <span class="inline-flex items-center gap-1.5 ${badgeCls} text-xs font-medium px-2.5 py-1 rounded-full">
          <i data-lucide="${icon}" class="w-3 h-3"></i>
          ${item.category}
        </span>
        <span class="text-xs text-ads-dim">No.${i + 1}</span>
      </div>
      <h2 class="text-base font-bold text-slate-900 mb-2">${item.headline}</h2>
      <p class="text-sm text-slate-600 leading-relaxed mb-3">${item.summary}</p>
      ${sourceLink}
    </div>
  </div>`;
  }).join('\n');

  const retailCount = newsData.news.filter(n => n.category === '量販店').length;
  const foodCount   = newsData.news.filter(n => n.category === '外食').length;

  const content = `
<div class="text-center mb-8 md:mb-10">
  <div class="inline-flex items-center gap-2 bg-ads-accent/10 text-ads-accent-light px-4 py-1.5 rounded-full text-sm font-medium mb-6">
    <i data-lucide="newspaper" class="w-4 h-4"></i>
    食品業界ニュース
  </div>
  <h1 class="text-3xl md:text-4xl font-black text-slate-900 tracking-tight mb-3">朝のニュース報告</h1>
  <p class="text-base text-ads-muted mb-6">${dateLabel}（${['日','月','火','水','木','金','土'][now.getDay()]}）― 量販店・外食を中心とした最新${newsData.news.length}本</p>
  <div class="flex flex-wrap items-center justify-center gap-3">
    <div class="flex items-center gap-2 bg-ads-accent/10 text-ads-accent-light border border-ads-accent/20 rounded-full px-4 py-1.5 text-sm font-medium">
      <i data-lucide="shopping-cart" class="w-3.5 h-3.5"></i>
      量販店 ${retailCount}本
    </div>
    <div class="flex items-center gap-2 bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 rounded-full px-4 py-1.5 text-sm font-medium">
      <i data-lucide="utensils" class="w-3.5 h-3.5"></i>
      外食 ${foodCount}本
    </div>
  </div>
</div>

<div class="space-y-3 mb-12">
${cards}
</div>

<div class="bg-ads-surface border border-ads-border rounded-xl p-5 text-center">
  <div class="flex items-center justify-center gap-2 mb-2">
    <i data-lucide="calendar" class="w-4 h-4 text-ads-dim"></i>
    <span class="text-sm font-medium text-slate-700">${dateLabel} 朝のニュース報告</span>
  </div>
  <p class="text-xs text-ads-muted">量販店・外食業界の最新動向 — Gemini AI + Google Search で自動収集</p>
</div>
`;

  return baseHtml
    .replace('<!-- TITLE -->', `食品業界 朝のニュース — ${dateLabel}`)
    .replace('<!-- TITLE -->', `食品業界 朝のニュース — ${dateLabel}`)
    .replace('<!-- DESCRIPTION -->', `${dateLabel}の食品業界（量販店・外食）最新ニュース${newsData.news.length}本`)
    .replace('<!-- CONTENT_START -->', '<!-- CONTENT_START -->\n' + content)
    .replace('<!-- CONTENT_END -->', '<!-- CONTENT_END -->');
}

// ─── 4. surge にデプロイ ───────────────────────────────────
function deploy(htmlPath) {
  const tmpDir = path.join(ROOT, 'output/_deploy_tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.copyFileSync(htmlPath, path.join(tmpDir, 'index.html'));

  execSync(
    `npx surge ${tmpDir} --domain ${domain} --token ${process.env.SURGE_TOKEN}`,
    { stdio: 'inherit' }
  );
  console.log(`✓ デプロイ完了: ${url}`);
}

// ─── 5. Slack に通知 ──────────────────────────────────────
async function postToSlack(newsData) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) { console.warn('SLACK_WEBHOOK_URL が未設定のためスキップします'); return; }

  const bulletList = newsData.news
    .map((n, i) => `*No.${i + 1} [${n.category}]* ${n.headline}`)
    .join('\n');

  const payload = {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `食品業界 朝のニュース — ${dateLabel}` },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: bulletList },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*詳細レポートを読む*\n${url}` },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: '開く' },
          url,
        },
      },
    ],
  };

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`Slack webhook エラー: ${res.status} ${await res.text()}`);
  console.log('✓ Slack に投稿しました');
}

// ─── main ─────────────────────────────────────────────────
(async () => {
  console.log(`\n=== 食品業界 朝のニュース生成 (${dateLabel}) ===\n`);

  // 環境変数チェック
  if (!process.env.GEMINI_API_KEY)  throw new Error('GEMINI_API_KEY が設定されていません');
  if (!process.env.SURGE_TOKEN)     throw new Error('SURGE_TOKEN が設定されていません');

  console.log('1. Gemini でニュースを収集中...');
  const newsData = await fetchNews();
  console.log(`   ${newsData.news.length} 件のニュースを取得しました`);
  newsData.news.forEach((n, i) => console.log(`   No.${i+1} [${n.category}] ${n.headline}`));

  console.log('\n2. HTML を生成中...');
  const outDir  = path.join(ROOT, 'output');
  const outFile = path.join(outDir, `food-news-${yyyy}${mm}${dd}.html`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, buildHtml(newsData), 'utf-8');
  console.log(`   保存: ${outFile}`);

  console.log('\n3. surge にデプロイ中...');
  deploy(outFile);

  console.log('\n4. Slack に通知中...');
  await postToSlack(newsData);

  console.log(`\n=== 完了 ===\n公開URL: ${url}\n`);
})();
