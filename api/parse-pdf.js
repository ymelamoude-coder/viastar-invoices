export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada no Vercel" });

  try {
    const { pdfBase64 } = req.body;
    if (!pdfBase64) return res.status(400).json({ error: "No PDF provided" });

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
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: pdfBase64 }
            },
            {
              type: "text",
              text: `Extract the purchase order or estimate data from this PDF and return ONLY valid JSON, no markdown, no explanation.

Return this exact structure:
{
  "customer": "customer company name",
  "items": [
    {
      "product": "product name (e.g. LOMBOK RUG, GOYA RUG, MAHAL RUG)",
      "color": "color name",
      "shape": "shape (Rectangular, Round, Organic 1, Organic 2, etc) - use Rectangular if not specified",
      "finishing": "Serged Edges or Folded Edges - use Serged Edges if not specified",
      "ft1": number,
      "in1": number,
      "ft2": number,
      "in2": number,
      "quantity": number,
      "price": number
    }
  ]
}

Rules:
- For product name: extract the rug type (LOMBOK, GOYA, MAHAL, DAYTONA, REPLAY, NOMAD, etc) and append RUG
- For MH2G POs: decode the SKU code (e.g. MHL-VIS-S-O2-S_8x10 = MAHAL RUG, Vision color, Serged Edges, Organic 2, ft1=8 in1=0 ft2=10 in2=0)
- For Modloft POs: decode SKU (e.g. GOY-SST-F-RT-S-9X12 = GOYA RUG, Stripes Silver color, Folded Edges, Rectangular, ft1=9 ft2=12)
- For Neiman POs: parse description text (e.g. "lombok 18 silver 8x10" = LOMBOK RUG, 18 Silver color, ft1=8 ft2=10)
- For Via Star estimates: read fields directly (Measurements, Shape, Color, Finishing)
- Extract ft and inches separately. Size "8x10" or "8'x10'" = ft1=8, in1=0, ft2=10, in2=0. Size "13ft 3in x 10ft 1in" = ft1=13, in1=3, ft2=10, in2=1
- customer: use the company/client name (not Via Star Rugs)`
            }
          ]
        })
      })
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || "{}";
    let parsed;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch(e) {
      return res.status(400).json({ error: "Could not parse PDF data", raw: text });
    }

    return res.status(200).json(parsed);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
