// Minimal stand-in for the Gemini streamGenerateContent endpoint, used only by Playwright E2E runs.
import { createServer } from "node:http";

const port = Number(process.env.MOCK_GEMINI_PORT || 4010);
const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\r\n\r\n`);
const chunk = (text, finishReason) => ({ candidates: [{ content: { role: "model", parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }] });

createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  if (!req.url.includes(":streamGenerateContent")) {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: { code: 404, status: "NOT_FOUND", message: "no" } }));
  }
  const src = JSON.parse(body).contents?.[0]?.parts?.[0]?.text ?? "";
  const source = (/<<<SOURCE_[0-9a-f]+\n([\s\S]*)\nSOURCE_[0-9a-f]+>>>/.exec(src) || [])[1] ?? "";
  if (source.includes("QUOTA")) {
    res.writeHead(429, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel" }] }] } }));
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  let closed = false;
  req.on("close", () => (closed = true));
  const arabic = /[؀-ۿ]/.test(source);
  const out = arabic
    ? "لا يعاني المريض من ضعف في الساق اليسرى، ويُظهر الرنين المغناطيسي انزلاقًا غضروفيًا محتملًا بين الفقرتين L4 وL5.\n\nيتناول Pregabalin بجرعة 75 mg مرتين يوميًا لمدة ٤ أسابيع. للمزيد: https://example.org/info\n@@FLAGS@@\n- عبارة «الرجل الشمال» فُسِّرت على أنها الساق اليسرى؛ يُرجى التأكد."
    : "The results show that 63% of patients improved (p = 0.04) [12]; however, this does not prove causation.";
  const parts = out.match(/[\s\S]{1,18}/g);
  for (const [i, p] of parts.entries()) {
    if (closed) return;
    if (source.includes("STALL") && i === 3) return; // hold the connection open forever
    sse(res, chunk(p, i === parts.length - 1 ? "STOP" : undefined));
    await new Promise((r) => setTimeout(r, 35));
  }
  res.end();
}).listen(port, "127.0.0.1", () => console.log(`mock gemini on ${port}`));
