module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY nao configurada" });

  try {
    const { pdfBase64 } = req.body;
    if (!pdfBase64) return res.status(400).json({ error: "No PDF provided" });

    const prompt = "Extract the purchase order or estimate data from this PDF and return ONLY valid JSON, no markdown, no explanation.\n\nReturn this exact structure:\n{\"customer\": \"company name\", \"items\": [{\"product\": \"PRODUCT RUG\", \"color\": \"color\", \"shape\": \"Rectangular\", \"finishing\": \"Serged Edges\", \"ft1\": 8, \"in1\": 0, \"ft2\": 10, \"in2\": 0, \"quantity\": 1, \"price\": 411.84}]}\n\nRules:\n- product: extract rug type and append RUG (e.g. LOMBOK RUG, GOYA RUG, MAHAL RUG)\n- MH2G SKU e.g. MHL-VIS-S-O2-S_8x10 = MAHAL RUG, Vision, Serged Edges, Organic 2, 8x10\n- Modloft SKU e.g. GOY-SST-F-RT-S-9X12 = GOYA RUG, Silver Stripes, Folded Edges, Rectangular, 9x12\n- Neiman description e.g. lombok 18 silver 8x10 = LOMBOK RUG, 18 Silver, 8x10\n- Via Star estimate: read fields directly\n- Size 8x10 means ft1=8 in1=0 ft2=10 in2=0. Size 13ft 3in x 10ft 1in means ft1=13 in1=3 ft2=10 in2=1\n- customer: buyer company name, NOT Via Star Rugs\n- shape default: Rectangular. finishing default: Serged Edges";

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
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

    const data = await response.json();
    const text = data.content && data.content[0] ? data.content[0].text : "{}";
    try {
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      return res.status(200).json(parsed);
    } catch(e) {
      return res.status(400).json({ error: "Nao foi possivel interpretar o PDF", raw: text });
    }
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
