module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY nao configurada" });

  try {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch(e) { return res.status(400).json({ error: "Invalid JSON body" }); }
    }

    const pdfBase64 = body && body.pdfBase64;
    if (!pdfBase64) return res.status(400).json({ error: "No PDF provided" });

    const prompt = [
      "Extract data from this PDF and return ONLY valid JSON with no extra text.",
      "",
      'Format: {"customer": "company name", "items": [{"product": "GOYA RUG", "color": "Silver Stripes", "shape": "Rectangular", "finishing": "Folded Edges", "ft1": 9, "in1": 0, "ft2": 12, "in2": 0, "quantity": 1, "price": 641.52}]}',
      "",
      "VALID PRODUCT COLORS (use EXACTLY these values):",
      "ALLURE RUG: 6483",
      "ANTIQUE PET RUG: Fendi",
      "ARTISAN RUG: 583, 663",
      "AUREN RUG: Beige, Cream",
      "BRISA RUG: Beige, Champagne",
      "DAYTONA RUG: Champagne, Ivory, Silver",
      "ESCAPE RUG: 70, 85",
      "GOYA RUG: Chevron Beige, Chevron Silver, Stripes Beige, Stripes Silver",
      "GRANELLO RUG: Cream, Fendi",
      "JAKARTA RUG: Zig Sand, Zig Silver",
      "LOMBOK RUG: 15 Beige, 15 Silver, 18 Beige, 18 Silver",
      "LOOP RUG: Beige, Cream",
      "MAHAL RUG: Black, Ivory, Vision",
      "NATURE RUG: Champagne, Sand, Silver",
      "NEW CONCEPT RUG: Beige, Cream",
      "NOMAD RUG: 650, 670",
      "PIENZA RUG: Cream, Green, Ice, Silver",
      "PURE RUG: 361",
      "REPLAY RUG: Beige, Cream, Silver",
      "SPOT RUG: Ice, Oil, Rust, Sand, Silver",
      "TANZANIA RUG: Beige, Cream",
      "VELVET RUG: Wheat",
      "",
      "Always pick the closest matching color from the valid list above.",
      "For Neiman 'lombok 18 silver' = LOMBOK RUG color='18 Silver'",
      "For Modloft SKU SST = Silver Stripes → GOYA RUG color='Stripes Silver'",
      "",
      "PRODUCT CODES: GOY=GOYA, MHL=MAHAL, LOM/LBK=LOMBOK, DAY=DAYTONA, LOP=LOOP, VLT/VLV=VELVET, ESC=ESCAPE, NAT=NATURE, NMD/NOM=NOMAD, RPL=REPLAY, ALL/ALR=ALLURE, ART=ARTISAN, BRS=BRISA, PNZ=PIENZA, TNZ/TAN=TANZANIA, SPT=SPOT, AUR=AUREN, GRN=GRANELLO, PUR=PURE, JCT=JAKARTA, NCP=NEW CONCEPT, ANT=ANTIQUE PET. Always append RUG.",
      "",
      "FINISHING: F=Folded Edges, S=Serged Edges. Default=Serged Edges",
      "SHAPE: RT=Rectangular, RD=Round, O1=Organic 1, O2=Organic 2, O3=Organic 3, O4=Organic 4, O5=Organic 5. Default=Rectangular",
      "",
      "Modloft SKU: GOY-SST-F-RT-S-9X12 = GOYA RUG, Stripes Silver, Folded Edges, Rectangular, 9x12",
      "MH2G SKU: MHL-VIS-S-O2-S_8x10 = MAHAL RUG, Vision, Serged Edges, Organic 2, 8x10",
      "Via Star estimate: read Measurements, Shape, Color, Finishing fields directly",
      "",
      "SIZE: 9x12 = ft1=9 in1=0 ft2=12 in2=0. 13ft 3in x 10ft 1in = ft1=13 in1=3 ft2=10 in2=1",
      "customer = buyer company name, NOT Via Star Rugs"
    ].join("\n");

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
    if (!text) return res.status(400).json({ error: "Empty response from Claude" });

    const clean = text.replace(/```json|```/g, "").trim();
    try {
      const parsed = JSON.parse(clean);
      return res.status(200).json(parsed);
    } catch(e) {
      return res.status(400).json({ error: "Could not parse Claude response", raw: text });
    }
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
