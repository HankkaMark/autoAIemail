const Parser = require("rss-parser");

/** 九个槽位：三栏 × 每栏三条 */
const BUCKET_ORDER = ["tech_trends", "startups_funding", "career_tools"];

const BUCKET_LABEL = {
  tech_trends: "技术 · 论文 · 趋势",
  startups_funding: "初创 · 融资 · 热度",
  career_tools: "成长 · 工具 · vibe coding",
};

const q = (s) => encodeURIComponent(s);

/**
 * 分栏 RSS：全局标题去重后，每栏各自打分取 top 3
 */
const FEEDS_BY_BUCKET = {
  tech_trends: [
    {
      name: "论文·前沿·中文",
      url: `https://news.google.com/rss/search?q=${q("大模型 论文 突破 arxiv")}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`,
    },
    {
      name: "行业趋势·中文",
      url: `https://news.google.com/rss/search?q=${q("人工智能 行业趋势 分析 展望")}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`,
    },
    {
      name: "Research·EN",
      url: `https://news.google.com/rss/search?q=LLM+research+paper+benchmark+breakthrough&hl=en-US&gl=US&ceid=US:en`,
    },
    {
      name: "Market·EN",
      url: `https://news.google.com/rss/search?q=AI+industry+trends+outlook+generative&hl=en-US&gl=US&ceid=US:en`,
    },
    {
      name: "模型发布·中文",
      url: `https://news.google.com/rss/search?q=${q("多模态 模型 发布 开源")}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`,
    },
  ],
  startups_funding: [
    {
      name: "融资·中文",
      url: `https://news.google.com/rss/search?q=${q("人工智能 融资 轮次 独角兽")}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`,
    },
    {
      name: "初创·中文",
      url: `https://news.google.com/rss/search?q=${q("AI 初创公司 融资 估值")}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`,
    },
    {
      name: "Funding·EN",
      url: `https://news.google.com/rss/search?q=AI+startup+funding+Series+seed+unicorn&hl=en-US&gl=US&ceid=US:en`,
    },
    {
      name: "Launch·EN",
      url: `https://news.google.com/rss/search?q=generative+AI+startup+raises+launch&hl=en-US&gl=US&ceid=US:en`,
    },
    {
      name: "Bing·VC",
      url: "https://www.bing.com/news/search?q=AI+venture+funding+startup&format=rss",
    },
  ],
  career_tools: [
    {
      name: "Vibe·EN",
      url: `https://news.google.com/rss/search?q=vibe+coding+AI+programming+tools&hl=en-US&gl=US&ceid=US:en`,
    },
    {
      name: "DevTools·EN",
      url: `https://news.google.com/rss/search?q=Cursor+OR+Copilot+OR+Windsurf+AI+coding+IDE+developer&hl=en-US&gl=US&ceid=US:en`,
    },
    {
      name: "PM技能·中文",
      url: `https://news.google.com/rss/search?q=${q("AI 产品经理 工具 技能 能力")}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`,
    },
    {
      name: "Agent·低代码·中文",
      url: `https://news.google.com/rss/search?q=${q("AI 智能体 低代码 工作流 自动化")}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`,
    },
    {
      name: "Learning·EN",
      url: `https://news.google.com/rss/search?q=AI+skills+for+product+managers+tools+2025&hl=en-US&gl=US&ceid=US:en`,
    },
  ],
};

function createParser() {
  return new Parser({
    timeout: 20000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "application/rss+xml, application/xml, text/xml, */*",
    },
  });
}

function normalizeTitle(t) {
  return (t || "")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .toLowerCase()
    .trim()
    .slice(0, 80);
}

function isToday(d) {
  if (!d) return false;
  const pub = new Date(d);
  if (Number.isNaN(pub.getTime())) return false;
  const now = new Date();
  return (
    pub.getFullYear() === now.getFullYear() &&
    pub.getMonth() === now.getMonth() &&
    pub.getDate() === now.getDate()
  );
}

function isRecentDays(d, days = 2) {
  if (!d) return false;
  const pub = new Date(d);
  if (Number.isNaN(pub.getTime())) return false;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return pub.getTime() >= cutoff;
}

function hasAiTechSignal(title, snippet = "") {
  const blob = `${title} ${snippet}`.toLowerCase();
  const raw = `${title} ${snippet}`;
  return (
    /\bai\b|artificial intelligence|machine learning|llm|gpt|coding|software|developer|openai|anthropic|startup|venture|saas|cloud|api|tool|model|agent|vibe/i.test(
      blob
    ) ||
    /人工智能|大模型|编程|开发|工具|智能体|初创|创投|融资|算法|产品|代码/i.test(raw)
  );
}

function noisePenalty(title, snippet = "") {
  if (hasAiTechSignal(title, snippet)) return 0;
  const t = (title || "").toLowerCase();
  if (
    /tractor|celebrity|nfl|nba\s|football\s|basketball|weather|horoscope/i.test(
      t
    )
  ) {
    return 80;
  }
  return 0;
}

function bucketScore(row, bucketId) {
  const blob = `${row.title} ${row.snippet || ""}`.toLowerCase();
  let boost = 0;
  if (bucketId === "tech_trends") {
    if (
      /paper|arxiv|benchmark|research|release|model|llm|gpt|开源|论文|趋势|前沿|多模态|突破/.test(
        blob
      )
    ) {
      boost += 1e15;
    }
  } else if (bucketId === "startups_funding") {
    if (
      /funding|series|seed|round|unicorn|ipo|估值|融资|轮|初创|million|billion|投资|并购/.test(
        blob
      )
    ) {
      boost += 1e15;
    }
  } else {
    if (
      /cursor|copilot|windsurf|vibe|coding|ide|tool|workflow|skill|课程|认证|agent|低代码|开发者|github|devin/.test(
        blob
      )
    ) {
      boost += 1e15;
    }
  }
  const time = new Date(row.pubDate || 0).getTime() || 0;
  const pen = noisePenalty(row.title, row.snippet);
  return time + boost - pen * 1e12;
}

function dateKeyInTimeZone(d, timeZone) {
  if (!d) return "";
  const pub = new Date(d);
  if (Number.isNaN(pub.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(pub);
}

/**
 * @param {{ timeZone?: string, preferYesterdayYmd?: string | null, perBucket?: number, minFromRecentDays?: number }} [opts]
 */
async function fetchNineBucketNews(opts = {}) {
  const {
    timeZone = "Asia/Shanghai",
    preferYesterdayYmd = null,
    perBucket = 3,
    minFromRecentDays = 5,
  } = opts;

  const parser = createParser();
  const globalSeen = new Set();
  const itemsByBucket = {};

  for (const bucketId of BUCKET_ORDER) {
    const feeds = FEEDS_BY_BUCKET[bucketId] || [];
    const pool = [];

    for (const feed of feeds) {
      try {
        const parsed = await parser.parseURL(feed.url);
        for (const item of parsed.items || []) {
          const title = (item.title || "").trim();
          if (!title) continue;

          const key = normalizeTitle(title);
          if (globalSeen.has(key)) continue;

          const pubDate = item.pubDate || item.isoDate || null;
          const snippet = (
            item.contentSnippet ||
            item.summary ||
            ""
          )
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 500);

          if (!hasAiTechSignal(title, snippet)) continue;

          globalSeen.add(key);

          pool.push({
            title,
            link: item.link || "",
            source: feed.name,
            pubDate,
            snippet,
            isToday: isToday(pubDate),
            recent: isRecentDays(pubDate, minFromRecentDays),
            dateKey: dateKeyInTimeZone(pubDate, timeZone),
            bucket: bucketId,
            bucketLabel: BUCKET_LABEL[bucketId],
          });
        }
      } catch (e) {
        console.warn(`Feed failed [${feed.name}]:`, e.message);
      }
    }

    let candidates = pool;
    if (preferYesterdayYmd) {
      const yest = pool.filter((n) => n.dateKey === preferYesterdayYmd);
      if (yest.length >= perBucket) candidates = yest;
    }

    candidates.sort((a, b) => bucketScore(b, bucketId) - bucketScore(a, bucketId));
    itemsByBucket[bucketId] = candidates.slice(0, perBucket);
  }

  const items = BUCKET_ORDER.flatMap((id) => itemsByBucket[id] || []);

  return {
    fetchedAt: new Date().toISOString(),
    timeZone,
    preferYesterdayYmd,
    items,
  };
}

function calendarYesterdayYmd(timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayStr = fmt.format(new Date());
  let ms = Date.now();
  while (fmt.format(new Date(ms)) === todayStr) {
    ms -= 3600000;
  }
  return fmt.format(new Date(ms));
}

module.exports = {
  BUCKET_ORDER,
  BUCKET_LABEL,
  FEEDS_BY_BUCKET,
  fetchNineBucketNews,
  calendarYesterdayYmd,
  dateKeyInTimeZone,
  normalizeTitle,
  hasAiTechSignal,
};
