/**
 * 每日邮件：昨日 9 条（三栏×3）+ 简述与外行补充。
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { applyOpenAiKeyFromEnv } = require("../lib/openAiEnv");
applyOpenAiKeyFromEnv();

const nodemailer = require("nodemailer");
const {
  fetchNineBucketNews,
  calendarYesterdayYmd,
} = require("../lib/newsAggregator");
const {
  enrichItemsWithDigestCn,
  buildDigestEmailInnerHtml,
  escapeHtml,
  escapeAttr,
} = require("../lib/starSummarize");

function buildFallbackBody(items, yesterdayLabel) {
  const blocks = items.map((it, i) => {
    const sn = it.snippet || "（暂无摘要，请点链接阅读原文）";
    const sec = it.bucketLabel ? ` · ${it.bucketLabel}` : "";
    return `
      <h2 style="font-size:1rem;margin:1em 0 0.4em;">${i + 1}. ${escapeHtml(it.title)}</h2>
      <p style="margin:0 0 0.35em;font-size:12px;color:#888;">${escapeHtml(sec)}</p>
      <p style="margin:0 0 0.5em;color:#444;line-height:1.55;">${escapeHtml(sn)}</p>
      <p style="margin:0 0 1em;font-size:0.9em;"><a href="${escapeAttr(it.link)}">阅读原文</a>
      <span style="color:#888;"> · ${escapeHtml(it.source || "")}</span></p>
    `;
  });
  return `
    <p style="color:#555;">以下为 <strong>${escapeHtml(yesterdayLabel)}</strong> 的 RSS 摘录（模型摘要未启用或失败）。配置 <code>OPENAI_API_KEY</code> 与 <code>OPENAI_BASE_URL</code> 后可生成简述与外行补充。</p>
    ${blocks.join("")}
  `;
}

async function main() {
  const tz = process.env.DIGEST_TZ || "Asia/Shanghai";
  const yesterdayYmd = calendarYesterdayYmd(tz);
  const yesterdayLabel = yesterdayYmd;

  const { items } = await fetchNineBucketNews({
    timeZone: tz,
    preferYesterdayYmd: yesterdayYmd,
    perBucket: 3,
    minFromRecentDays: 6,
  });

  if (!items.length) {
    console.error("No news items fetched; abort send.");
    process.exit(1);
  }

  const dig = await enrichItemsWithDigestCn(items);
  let innerHtml;
  if (dig.ok && dig.items.some((x) => x.digest)) {
    innerHtml = buildDigestEmailInnerHtml(dig.items, yesterdayLabel);
  } else {
    if (dig.error && dig.error !== "no_api_key") {
      console.warn("简报生成失败，使用 RSS 摘录：", dig.error);
    }
    innerHtml = buildFallbackBody(dig.items, yesterdayLabel);
  }

  const subject = `【AI PM 晨报】${yesterdayLabel} · 9 条（趋势/融资/工具）`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
  <body style="font-family:system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;max-width:680px;margin:24px auto;padding:0 16px;color:#111;">
  <h1 style="font-size:1.35rem;">AI PM 面试备战 · 每日情报</h1>
  ${innerHtml}
  <hr style="border:none;border-top:1px solid #eee;margin:2em 0;" />
  <p style="font-size:12px;color:#999;">RSS 聚合 · ${new Date().toISOString()}</p>
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
      "\n【常见原因】连接 Gmail SMTP 失败。可换 QQ/163/Outlook 或仅在 GitHub Actions 上发信。\n"
    );
  }
  console.error(e);
  process.exit(1);
});
