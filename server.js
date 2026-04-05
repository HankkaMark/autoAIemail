const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { applyOpenAiKeyFromEnv, hasOpenAiKey } = require("./lib/openAiEnv");
applyOpenAiKeyFromEnv();

const express = require("express");
const { fetchNineBucketNews } = require("./lib/newsAggregator");
const { enrichItemsWithDigestCn } = require("./lib/starSummarize");

const app = express();
const PORT = Number.parseInt(process.env.PORT || "3847", 10) || 3847;

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/top-news", async (_req, res) => {
  try {
    const { fetchedAt, items } = await fetchNineBucketNews({
      minFromRecentDays: 4,
    });

    const dig = await enrichItemsWithDigestCn(items);

    res.json({
      ok: true,
      fetchedAt,
      count: dig.items.length,
      digestMeta: {
        openAiConfigured: hasOpenAiKey(),
        usedAi: dig.ok,
        error: dig.error || null,
        hint: dig.hint || null,
      },
      items: dig.items,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      ok: false,
      error: err.message || "unknown",
      items: [],
      digestMeta: {
        openAiConfigured: hasOpenAiKey(),
        usedAi: false,
        error: null,
        hint: null,
      },
    });
  }
});

const server = app.listen(PORT, () => {
  const key = process.env.OPENAI_API_KEY || "";
  console.log(`Open http://localhost:${PORT}`);
  if (key) {
    console.log(
      `[Digest] OPENAI_API_KEY 已加载（长度 ${key.length}）。9 条分栏简报依赖模型生成简述与补充说明。`
    );
  } else {
    console.warn(
      "[Digest] 未读取到 OPENAI_API_KEY：仅显示 RSS 原文，无中文简述。"
    );
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\n[端口占用] ${PORT} 已被占用。关掉旧 npm start 或执行：$env:PORT=3850; npm start\n`
    );
    process.exit(1);
  }
  throw err;
});
