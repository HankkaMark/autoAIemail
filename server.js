const express = require("express");
const path = require("path");
const { fetchAggregatedNews } = require("./lib/newsAggregator");

const app = express();
const PORT = process.env.PORT || 3847;

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/top-news", async (_req, res) => {
  try {
    const { fetchedAt, items } = await fetchAggregatedNews({
      limit: 5,
      minFromRecentDays: 3,
    });

    res.json({
      ok: true,
      fetchedAt,
      count: items.length,
      items,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      ok: false,
      error: err.message || "unknown",
      items: [],
    });
  }
});

app.listen(PORT, () => {
  console.log(`Open http://localhost:${PORT}`);
});
