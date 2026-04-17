module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY nao configurada" });

  try {
    // Handle body parsing - Vercel may pass raw string or object
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch(e) { return res.status(400).json({ error: "Invalid JSON body" }); }
    }

    const pdfBase64 = body && body.pdfBase64;
    if (!pdfBase64) return res.status(400).json({ error: "No PDF provided", bodyKeys: Object.keys(body || {}) });

    const prompt = "Extract data from this PDF and return ONLY valid JSON with no extra text.\n\nFormat: {\"customer\": \"company name\", \"items\": [{\"product\": \"GOYA RUG\", \"color\": \"Silver Stripes\", \"shape\": \"Rectangular\", \"finishing\": \"Folded Edges\", \"ft1\": 9, \"in1\": 0, \"ft2\": 12, \"in2\": 0, \"quantity\": 1, \"price\": 641.52}]}\n\nRules for product names: always append RUG (GOYA RUG, MAHAL RUG, LOMBOK RUG, DAYTONA RUG, etc)\nRules for Modloft SKU GOY-SST-F-RT-S-9X12: product=GOYA RUG, color=Silver Stripes, finishing=Folded Edges, shape=Rectangular, size=9x12\nRules for MH2G SKU MHL-VIS-S-O2-S_8x10: product=MAHAL RUG, color=Vision, finishing=Serged Edges, shape=Organic 2, size=8x10\nRules for Neiman: parse text like 'lombok 18 silver 8x10' as product=LOMBOK RUG color=18 Silver size=8x10\nFor size like 9x12 set ft1=9 in1=0 ft2=12 in2=0. For 13ft 3in x 10ft: ft1=13 in1=3 ft2=10 in2=0\ncustomer = the buyer company (NOT Via Star Rugs)\nDefault shape=Rectangular, default finishing=Serged Edges";

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
            { type: "text", text: prompt }
          ]
        }]
      })
    });

    const data = await anthropicRes.json();

    if (data.error) return res.status(400).json({ error: "Anthropic error: " + data.error.message });

    const text = data.content && data.content[0] ? data.content[0].text : "";
    if (!text) return res.status(400).json({ error: "Empty response from Claude", data: data });

    const clean = text.replace(/```json|```/g, "").trim();
    try {
      const parsed = JSON.parse(clean);
      return res.status(200).json(parsed);
    } catch(e) {
      return res.status(400).json({ error: "Could not parse Claude response", raw: text });
    }
  } catch(e) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
};
