/**
 * 每日邮件：总结「指定时区日历上的昨天」AI 创投相关热门 5 条，发到邮箱。
 * 用法: 配置环境变量后 node scripts/sendDailyDigest.js
 * 定时: 见 .github/workflows/daily-digest.yml（北京时间 8:00）或系统计划任务。
 *
 * 必填: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_TO
 * 选填: MAIL_FROM（默认 SMTP_USER）, DIGEST_TZ（默认 Asia/Shanghai）,
 *       OPENAI_API_KEY（填写则用模型生成中文摘要；不填则用 RSS 摘要拼邮件）
 */

require("dotenv").config();

const nodemailer = require("nodemailer");
const {
  fetchAggregatedNews,
  calendarYesterdayYmd,
} = require("../lib/newsAggregator");

function stripHtml(html) {
  if (!html) return "";
  return String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

function buildFallbackBody(items, yesterdayLabel) {
  const blocks = items.map((it, i) => {
    const sn = it.snippet || "（暂无摘要，请点链接阅读原文）";
    return `
      <h2 style="margin:1.2em 0 0.4em;font-size:1.05rem;">${i + 1}. ${escapeHtml(it.title)}</h2>
      <p style="margin:0 0 0.5em;color:#444;line-height:1.55;">${escapeHtml(sn)}</p>
      <p style="margin:0 0 1em;font-size:0.9em;"><a href="${escapeAttr(it.link)}">阅读原文</a>
      <span style="color:#888;"> · ${escapeHtml(it.source)}</span></p>
    `;
  });
  return `
    <p style="color:#555;">以下为 <strong>${escapeHtml(yesterdayLabel)}</strong>（按 AI/创投相关度与时效综合排序）的 5 条要闻摘要，由 RSS 自动摘录。</p>
    ${blocks.join("")}
  `;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

async function summarizeWithOpenAI(items, yesterdayLabel) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const payload = items.map((it, i) => ({
    n: i + 1,
    title: it.title,
    snippet: (it.snippet || "").slice(0, 350),
    link: it.link,
    source: it.source,
  }));

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "你是科技创投媒体编辑。根据用户给出的新闻条目，用简体中文写一封邮件正文 HTML（只输出 body 内片段，不要 html/head 标签）。要求：开头一两句总括昨天 AI 创投圈热点；然后 5 个小节，每节标题用「1. 简短标题」形式，下面 2～4 句中文概括，句末可附（详见原文）并保留提供的链接为 <a href=\"...\">阅读原文</a>。语气专业、简洁。",
        },
        {
          role: "user",
          content: `日期（用户时区昨天）：${yesterdayLabel}\n\n条目 JSON：\n${JSON.stringify(payload, null, 2)}`,
        },
      ],
      temperature: 0.4,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error: ${res.status} ${err}`);
  }
  const data = await res.json();
  let text = data.choices?.[0]?.message?.content?.trim();
  if (text) {
    text = text.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }
  return text || null;
}

async function main() {
  const tz = process.env.DIGEST_TZ || "Asia/Shanghai";
  const yesterdayYmd = calendarYesterdayYmd(tz);
  const yesterdayLabel = yesterdayYmd;

  const { items } = await fetchAggregatedNews({
    timeZone: tz,
    preferYesterdayYmd: yesterdayYmd,
    limit: 5,
    minFromRecentDays: 5,
  });

  if (!items.length) {
    console.error("No news items fetched; abort send.");
    process.exit(1);
  }

  let innerHtml;
  try {
    innerHtml = await summarizeWithOpenAI(items, yesterdayLabel);
  } catch (e) {
    console.warn("OpenAI summary failed, using fallback:", e.message);
    innerHtml = null;
  }
  if (!innerHtml) {
    innerHtml = buildFallbackBody(items, yesterdayLabel);
  }

  const subject = `【AI 创投日报】${yesterdayLabel} 热门 5 条`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
  <body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:640px;margin:24px auto;padding:0 16px;color:#111;">
  <h1 style="font-size:1.25rem;">AI 创投 · 昨日要闻</h1>
  ${innerHtml}
  <hr style="border:none;border-top:1px solid #eee;margin:2em 0;" />
  <p style="font-size:12px;color:#999;">自动聚合 RSS · ${new Date().toISOString()}</p>
  </body></html>`;

  const host = process.env.SMTP_HOST;
  const portRaw = Number.parseInt(process.env.SMTP_PORT || "587", 10);
  const port =
    Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to = process.env.MAIL_TO;
  const from = process.env.MAIL_FROM || user;

  if (!host || !user || !pass || !to) {
    console.error(
      "Missing env: SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_TO (and optionally SMTP_PORT, MAIL_FROM)"
    );
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 25000,
  });

  await transporter.sendMail({
    from,
    to,
    subject,
    html,
  });

  console.log("Sent:", subject, "→", to);
}

main().catch((e) => {
  const host = (process.env.SMTP_HOST || "").toLowerCase();
  if (
    (e.code === "ETIMEDOUT" || e.code === "ECONNREFUSED") &&
    (host.includes("gmail") || host.includes("google"))
  ) {
    console.error(
      "\n【常见原因】连接 Gmail SMTP 失败。若你当前在中国大陆或未使用代理，访问 smtp.gmail.com 常被网络屏蔽，会出现 “Greeting never received / ETIMEDOUT”。\n" +
        "【可行做法】① 换用 QQ邮箱 / 163邮箱 / Outlook 的 SMTP 填进 .env；② 或仅在 GitHub Actions（境外）上跑定时发信，本地不再跑 npm run digest；③ 若你有稳定访问 Google 的网络，再试本地发送。\n"
    );
  }
  console.error(e);
  process.exit(1);
});
