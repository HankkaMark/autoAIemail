const Parser = require("rss-parser");

const FEEDS = [
  {
    name: "中文 · AI 投融资",
    url: "https://news.google.com/rss/search?q=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD+%E6%8A%95%E8%B5%84+%E8%9E%8D%E8%B5%84&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
  },
  {
    name: "中文 · 创投 AI",
    url: "https://news.google.com/rss/search?q=AI+%E5%88%9B%E6%8A%95+%E8%9E%8D%E8%B5%84&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
  },
  {
    name: "EN · AI venture funding",
    url: "https://news.google.com/rss/search?q=AI+venture+capital+funding&hl=en-US&gl=US&ceid=US:en",
  },
  {
    name: "Bing · AI VC",
    url: "https://www.bing.com/news/search?q=artificial+intelligence+venture+capital+funding&format=rss",
  },
];

function createParser() {
  return new Parser({
    timeout: 15000,
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

function vcAiScore(title) {
  const t = (title || "").toLowerCase();
  const raw = title || "";
  let s = 0;
  if (
    /venture|funding|invest|investor|\$|million|billion|series\s*[a-z]|seed\s+round|ipo|capital|raises|raised|unicorn|valuation|vc\b/i.test(
      t
    )
  ) {
    s += 4;
  }
  if (/融资|投资|创投|募资|估值|轮|独角兽|风投|私募/i.test(raw)) s += 4;
  if (
    /\bai\b|artificial intelligence|machine learning|llm|generative|startup/i.test(
      t
    ) ||
    /人工智能|大模型|生成式|初创|创业/i.test(raw)
  ) {
    s += 2;
  }
  return s;
}

/** @param {string} d ISO or RSS date string */
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
 * @param {{ timeZone?: string, preferYesterdayYmd?: string, limit?: number, minFromRecentDays?: number }} [opts]
 */
async function fetchAggregatedNews(opts = {}) {
  const {
    timeZone = "Asia/Shanghai",
    preferYesterdayYmd = null,
    limit = 5,
    minFromRecentDays = 3,
  } = opts;

  const parser = createParser();
  const all = [];
  const seen = new Set();

  for (const feed of FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);
      for (const item of parsed.items || []) {
        const title = (item.title || "").trim();
        if (!title) continue;
        const key = normalizeTitle(title);
        if (seen.has(key)) continue;
        seen.add(key);

        const pubDate = item.pubDate || item.isoDate || null;
        const snippet = (
          item.contentSnippet ||
          item.summary ||
          ""
        ).replace(/\s+/g, " ").trim().slice(0, 500);

        all.push({
          title,
          link: item.link || "",
          source: feed.name,
          pubDate,
          snippet,
          isToday: isToday(pubDate),
          recent: isRecentDays(pubDate, minFromRecentDays),
          dateKey: dateKeyInTimeZone(pubDate, timeZone),
        });
      }
    } catch (e) {
      console.warn(`Feed failed [${feed.name}]:`, e.message);
    }
  }

  function scoreRow(n, yesterdayYmd) {
    const time = new Date(n.pubDate || 0).getTime() || 0;
    const rel = vcAiScore(n.title) * 1e14;
    let score = time / 1e6 + rel;
    if (yesterdayYmd && n.dateKey === yesterdayYmd) score += 1e20;
    if (n.isToday) score += 1e18;
    if (n.recent) score += 1e16;
    return score;
  }

  let candidates = all;
  if (preferYesterdayYmd) {
    const yest = all.filter((n) => n.dateKey === preferYesterdayYmd);
    if (yest.length >= limit) {
      candidates = yest;
    }
  }

  const scored = candidates.map((n) => ({
    ...n,
    _score: scoreRow(n, preferYesterdayYmd),
  }));
  scored.sort((a, b) => b._score - a._score);
  const top = scored.slice(0, limit).map(({ _score, ...rest }) => rest);

  return {
    fetchedAt: new Date().toISOString(),
    timeZone,
    preferYesterdayYmd,
    items: top,
  };
}

/** 指定时区「日历上的昨天」YYYY-MM-DD（不依赖本机本地时区） */
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
  FEEDS,
  fetchAggregatedNews,
  vcAiScore,
  calendarYesterdayYmd,
  dateKeyInTimeZone,
};
