/**
 * 中文简报：简述 + 外行补充 + 面试一句。面向准备 AI PM 面试、需持续跟市场的人。
 */

const { BUCKET_ORDER, BUCKET_LABEL } = require("./newsAggregator");

function starErrorHint(errorText) {
  const t = (errorText || "").toLowerCase();
  if (
    t.includes("invalid_issuer") ||
    t.includes("not from a valid issuer")
  ) {
    return (
      "服务端认为：你填的「密钥」不是当前请求地址所接受的颁发方。" +
      "请确认 OPENAI_BASE_URL 与 OPENAI_API_KEY 成套；官方 OpenAI 使用 https://api.openai.com 与平台 API Key。"
    );
  }
  if (t.includes("incorrect api key") || t.includes("invalid_api_key")) {
    return "API Key 被拒绝。请核对是否复制完整、是否有多余空格。";
  }
  if (t.includes("401")) {
    return "认证失败（401）。请核对 Key 与 OPENAI_BASE_URL 是否匹配。";
  }
  return null;
}

async function callOpenAiJson(messages, model) {
  const key = (process.env.OPENAI_API_KEY || "").trim();
  if (!key) throw new Error("OPENAI_API_KEY missing");

  let base = (process.env.OPENAI_BASE_URL || "https://api.openai.com").replace(
    /\/$/,
    ""
  );
  const completionsUrl = /\/v1$/i.test(base)
    ? `${base}/chat/completions`
    : `${base}/v1/chat/completions`;

  const resolvedModel = model || process.env.OPENAI_MODEL || "gpt-4.1";
  const payload = {
    model: resolvedModel,
    response_format: { type: "json_object" },
    messages,
  };
  const tempEnv = process.env.OPENAI_TEMPERATURE;
  if (tempEnv !== undefined && String(tempEnv).trim() !== "") {
    const n = Number.parseFloat(tempEnv);
    if (!Number.isNaN(n)) payload.temperature = n;
  } else if (!/^gpt-5/i.test(resolvedModel)) {
    payload.temperature = 0.35;
  }

  const res = await fetch(completionsUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI ${res.status}: ${err}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error("Empty OpenAI response");
  return JSON.parse(raw);
}

const DIGEST_SYSTEM = `你是给「准备 AI 产品经理面试、需要持续跟上市场」的读者写简报。
你会收到某一固定栏目下的几条新闻（同一栏目主题相近）。栏目有三种：
- 技术·论文·趋势：模型、论文、评测、行业方向、监管与大厂技术叙事等。
- 初创·融资·热度：新公司、融资轮次、独角兽、赛道热度、并购等。
- 成长·工具·vibe coding：编程范式、AI 编码工具、工作流、PM/业务侧该掌握的能力与工具。

对每条新闻输出简体中文 JSON 数组中的一项，字段如下：
- brief：2～4 句「核心简述」。信息密度高，读者 15 秒内知道发生了什么、为什么 PM 要在意。
- layperson_note：4～8 句「外行也能懂的补充」。若提到公司/机构：简要是谁、做什么、近期关键动作、在赛道里大致身位（龙头/挑战者/垂直玩家等），不确定写「据公开信息」。若提到技术/论文/模型：用具体产品或用户场景解释「是什么、现实中怎么用」，少 jargon。若提到工具或 vibe coding：说明为何火、典型用法、对 PM 与业务协作的含义。
- interview_hook：1 句，面试或 coffee chat 里可以复述的观点、判断或反问。

必须严格输出 JSON：{"items":[{"index":1,"brief":"...","layperson_note":"...","interview_hook":"..."}]}
index 与输入 news 中每条 index 一致，条数必须一致。不要 markdown，不要额外字段。`;

async function enrichOneBucketSlice(slice) {
  if (!slice.length) return [];

  const bucketId = slice[0].bucket;
  const sectionTitle = BUCKET_LABEL[bucketId] || bucketId;

  const payload = slice.map((it, idx) => ({
    index: idx + 1,
    title: it.title,
    snippet: (it.snippet || "").slice(0, 520),
    link: it.link,
  }));

  const parsed = await callOpenAiJson(
    [
      { role: "system", content: DIGEST_SYSTEM },
      {
        role: "user",
        content: JSON.stringify({
          section: sectionTitle,
          section_id: bucketId,
          news: payload,
        }),
      },
    ],
    process.env.OPENAI_MODEL
  );

  const list = Array.isArray(parsed.items) ? parsed.items : [];
  const byIndex = new Map(list.map((x) => [x.index, x]));

  return slice.map((it, idx) => {
    const s = byIndex.get(idx + 1);
    if (!s || !s.brief || !s.layperson_note) {
      return { ...it, digest: null };
    }
    return {
      ...it,
      digest: {
        brief: String(s.brief).trim(),
        layperson_note: String(s.layperson_note).trim(),
        interview_hook: String(s.interview_hook || "").trim(),
      },
    };
  });
}

/**
 * 分栏各调用一次模型，避免 9 条单次超长；失败栏 fallback digest:null
 * @returns {Promise<{ ok: boolean, items: Array<any>, error?: string | null, hint?: string | null }>}
 */
async function enrichItemsWithDigestCn(allItems) {
  if (!allItems?.length) {
    return { ok: true, items: [], error: null, hint: null };
  }

  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return {
      ok: false,
      error: "no_api_key",
      hint: null,
      items: allItems.map((it) => ({ ...it, digest: null })),
    };
  }

  const enrichedParts = [];
  const errors = [];

  for (const bucketId of BUCKET_ORDER) {
    const slice = allItems.filter((i) => i.bucket === bucketId);
    if (!slice.length) continue;

    try {
      const part = await enrichOneBucketSlice(slice);
      enrichedParts.push(...part);
    } catch (e) {
      const msg = e.message || String(e);
      console.error(`[Digest] 栏目 ${bucketId} 失败:`, msg);
      errors.push(msg);
      enrichedParts.push(...slice.map((it) => ({ ...it, digest: null })));
    }
  }

  const anyDigest = enrichedParts.some((x) => x.digest);
  return {
    ok: anyDigest,
    error: anyDigest ? null : errors[0] || "digest_failed",
    hint: anyDigest ? null : starErrorHint(errors.join(" ")),
    items: enrichedParts,
  };
}

/** @deprecated 兼容旧名 */
async function enrichItemsWithStarCn(items) {
  return enrichItemsWithDigestCn(items);
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

function buildDigestEmailInnerHtml(items, dateLabel) {
  const intro = `<p style="color:#333;line-height:1.65;font-size:15px;">你好，这是 <strong>${escapeHtml(
    dateLabel
  )}</strong> 的 <strong>9 条</strong>精选，分三栏：技术趋势 / 初创融资 / 成长与工具。每栏各 3 条；每条含<strong>简述</strong>与<strong>外行补充</strong>，并附原文链接。</p>`;

  let currentBucket = null;
  let globalIdx = 0;
  const blocks = [];

  for (const it of items) {
    if (it.bucket !== currentBucket) {
      currentBucket = it.bucket;
      const h = BUCKET_LABEL[it.bucket] || it.bucket;
      blocks.push(
        `<h2 style="font-size:17px;margin:1.6em 0 0.6em;padding-bottom:6px;border-bottom:2px solid #0d9488;color:#134e4a;">${escapeHtml(
          h
        )}</h2>`
      );
    }

    globalIdx += 1;
    const d = it.digest;

    if (!d) {
      blocks.push(`
        <div style="margin-bottom:1.25em;padding:14px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;">
          <p style="margin:0 0 8px;font-weight:600;">${globalIdx}. ${escapeHtml(it.title)}</p>
          <p style="margin:0 0 8px;color:#555;font-size:14px;line-height:1.55;">${escapeHtml(it.snippet || "（摘要暂缺）")}</p>
          <a href="${escapeAttr(it.link)}" style="color:#0369a1;font-size:14px;">阅读原文 →</a>
        </div>`);
      continue;
    }

    blocks.push(`
      <div style="margin-bottom:1.35em;padding:16px 18px;background:#fafafa;border:1px solid #e5e7eb;border-radius:10px;">
        <p style="margin:0 0 10px;font-size:13px;color:#64748b;">${globalIdx} · ${escapeHtml(it.source || "")}</p>
        <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#111;font-weight:600;">简述</p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#1f2937;">${escapeHtml(d.brief)}</p>
        <p style="margin:0 0 8px;font-size:14px;color:#0f766e;font-weight:600;">外行补充（背景 / 例子 / 身位）</p>
        <p style="margin:0 0 14px;font-size:14px;line-height:1.65;color:#374151;">${escapeHtml(d.layperson_note)}</p>
        ${
          d.interview_hook
            ? `<p style="margin:0 0 12px;padding:10px 12px;background:#ecfdf5;border-radius:8px;font-size:14px;color:#065f46;"><strong>面试一句：</strong>${escapeHtml(d.interview_hook)}</p>`
            : ""
        }
        <p style="margin:0;font-size:14px;"><a href="${escapeAttr(it.link)}" style="color:#0369a1;">阅读原文 →</a></p>
        <p style="margin:8px 0 0;font-size:12px;color:#9ca3af;">原标题：${escapeHtml(it.title)}</p>
      </div>`);
  }

  return intro + blocks.join("");
}

/** @deprecated */
function buildStarEmailInnerHtml(items, dateLabel) {
  return buildDigestEmailInnerHtml(items, dateLabel);
}

module.exports = {
  starErrorHint,
  enrichItemsWithDigestCn,
  enrichItemsWithStarCn,
  buildDigestEmailInnerHtml,
  buildStarEmailInnerHtml,
  escapeHtml,
  escapeAttr,
};
