/**
 * 规范化 .env 里的 OPENAI_API_KEY，避免首尾空格、成对引号、UTF-8 BOM 导致「读不到 Key」。
 */

function stripBom(s) {
  if (!s) return s;
  const c = s.charCodeAt(0);
  if (c === 0xfeff || c === 0xfffe) return s.slice(1);
  return s;
}

/**
 * 在 dotenv.config() 之后调用：就地修正 process.env.OPENAI_API_KEY
 */
function applyOpenAiKeyFromEnv() {
  const bomKey = "\ufeffOPENAI_API_KEY";
  if (!process.env.OPENAI_API_KEY && process.env[bomKey]) {
    process.env.OPENAI_API_KEY = process.env[bomKey];
    delete process.env[bomKey];
  }

  let v = process.env.OPENAI_API_KEY;
  if (v === undefined || v === null) return;

  v = stripBom(String(v)).trim();

  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }

  if (!v) {
    delete process.env.OPENAI_API_KEY;
    return;
  }

  process.env.OPENAI_API_KEY = v;
}

function hasOpenAiKey() {
  const v = process.env.OPENAI_API_KEY;
  return typeof v === "string" && v.length > 0;
}

module.exports = { applyOpenAiKeyFromEnv, hasOpenAiKey };
