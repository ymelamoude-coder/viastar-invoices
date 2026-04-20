const WAVE_TOKEN = "EW7tDC2BxTPFUmzxbtNrBABv2GBCGV";
const BUSINESS_ID = "QnVzaW5lc3M6NGM3ZGVjM2EtYWY3My00ZTlmLTk4MGItNjhiM2Q3M2RkZTEw";

async function gql(query, variables) {
  const res = await fetch("https://gql.waveapps.com/graphql/public", {
    method: "POST",
    headers: { "Authorization": "Bearer " + WAVE_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables })
  });
  return res.json();
}

async function findProductId(itemName) {
  const data = await gql(`query { business(id: "${BUSINESS_ID}") { products(page: 1, pageSize: 200) { edges { node { id name } } } } }`, {});
  const products = data?.data?.business?.products?.edges || [];
  const search = itemName.toUpperCase().trim();
  const searchNoRug = search.replace(' RUG', '').trim();

  // Filter out Z-prefix duplicates
  const valid = products.filter(e => !e.node.name.toUpperCase().trim().startsWith('Z '));

  // Priority 1: exact match with " RUG" suffix (e.g. "SPOT RUG" === "SPOT RUG")
  let match = valid.find(e => e.node.name.toUpperCase().trim() === search);
  if (match) return match.node.id;

  // Priority 2: exact match without " RUG" (e.g. "SPOT" === "SPOT")
  match = valid.find(e => e.node.name.toUpperCase().trim() === searchNoRug);
  if (match) return match.node.id;

  // Priority 3: product name is exactly one word + "RUG" — "SPOT RUG" not "QUARTO FILHO - SPOT - OIL BLUE"
  match = valid.find(e => {
    const name = e.node.name.toUpperCase().trim();
    // Must be "<word> RUG" or "<word>" only - no dashes, no extra words
    return (name === searchNoRug + ' RUG' || name === searchNoRug) && !name.includes('-');
  });
  if (match) return match.node.id;

  // Priority 4: contains match but name is short (<=20 chars) and has no dashes (avoids long custom names)
  match = valid.find(e => {
    const name = e.node.name.toUpperCase().trim();
    if (name.length > 20 || name.includes('-')) return false;
    return name.includes(searchNoRug) || searchNoRug.includes(name.replace(' RUG', ''));
  });
  if (match) return match.node.id;

  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET" && req.query.action === "customers") {
    try {
      const data = await gql(`query { business(id: "${BUSINESS_ID}") { customers(page: 1, pageSize: 200) { edges { node { id name } } } } }`, {});
      const customers = data?.data?.business?.customers?.edges?.map(e => e.node) || [];
      return res.status(200).json({ customers });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  if (req.method === "GET" && req.query.action === "invoice") {
    try {
      const invoiceNumber = String(req.query.number).trim();
      if (!invoiceNumber) return res.status(400).json({ error: "Informe o número da invoice" });
      // Search through invoices - Wave returns them ordered by recent first
      let found = null;
      let totalChecked = 0;
      let sampleNumbers = [];
      for (let page = 1; page <= 50; page++) {
        const data = await gql(`query { business(id: "${BUSINESS_ID}") { invoices(page: ${page}, pageSize: 50) { edges { node { id invoiceNumber customer { name } items { product { name } description quantity unitPrice { value } } } } pageInfo { currentPage totalPages } } } }`, {});
        const invoices = data?.data?.business?.invoices?.edges || [];
        totalChecked += invoices.length;
        if (page === 1) sampleNumbers = invoices.slice(0, 5).map(e => String(e.node.invoiceNumber));
        found = invoices.find(e => String(e.node.invoiceNumber).trim() === invoiceNumber || String(e.node.invoiceNumber).trim().replace(/^0+/, '') === invoiceNumber.replace(/^0+/, ''));
        if (found) break;
        const info = data?.data?.business?.invoices?.pageInfo;
        if (!info || page >= info.totalPages) break;
      }
      if (!found) return res.status(404).json({
        error: "Invoice " + invoiceNumber + " não encontrada. Verificadas " + totalChecked + " invoices. Exemplos de números encontrados: " + sampleNumbers.join(", ")
      });
      const inv = found.node;
      // Parse items from description
      const items = inv.items.map(it => {
        const desc = it.description || "";
        const meas = (desc.match(/Measurements:\s*([^\n]+)/i) || [])[1] || "";
        const shape = (desc.match(/Shape:\s*([^\n]+)/i) || [])[1] || "Rectangular";
        const color = (desc.match(/Color:\s*([^\n]+)/i) || [])[1] || "";
        const finishing = (desc.match(/Finishing:\s*([^\n]+)/i) || [])[1] || "";
        const sku = (desc.match(/SKU:\s*([^\n]+)/i) || [])[1] || "";
        return {
          name: it.product?.name || "",
          measurements: meas.trim(),
          shape: shape.trim(),
          color: color.trim(),
          finishing: finishing.trim(),
          sku: sku.trim(),
          quantity: parseInt(it.quantity) || 1,
          price: it.unitPrice?.value || 0
        };
      });
      return res.status(200).json({
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customer?.name || "",
        items
      });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  if (req.method === "POST") {
    try {
      const { customerId, items, docType } = req.body;
      if (!customerId || !items || items.length === 0) return res.status(400).json({ error: "Dados incompletos." });

      const formattedItems = [];
      for (const item of items) {
        const productId = await findProductId(item.name);
        if (!productId) return res.status(400).json({ error: "Produto não encontrado: " + item.name });
        const description = "Measurements: " + item.measurements +
          (item.shape && item.shape !== "Rectangular" ? "\nShape: " + item.shape : "") +
          "\nColor: " + item.color + "\nFinishing: " + item.finishing + "\nSKU: " + item.sku;
        formattedItems.push({ productId, quantity: String(item.quantity), unitPrice: String(parseFloat(item.price).toFixed(2)), description });
      }

      const input = { businessId: BUSINESS_ID, customerId, items: formattedItems };

      if (docType === "estimate") {
        const data = await gql(`mutation($input: EstimateCreateInput!) { estimateCreate(input: $input) { estimate { id estimateNumber viewUrl } didSucceed inputErrors { message } } }`, { input });
        if (data?.data?.estimateCreate?.didSucceed) {
          const est = data.data.estimateCreate.estimate;
          return res.status(200).json({ success: true, number: est.estimateNumber, viewUrl: est.viewUrl, type: "estimate" });
        } else if (data?.errors?.[0]?.extensions?.code === "INTERNAL_SERVER_ERROR") {
          return res.status(400).json({ error: "O Wave não suporta criação de estimates via API no momento. Por favor crie como Invoice e converta para Estimate dentro do Wave." });
        } else {
          const errs = data?.data?.estimateCreate?.inputErrors?.map(e => e.message).join(", ") || "unknown";
          return res.status(400).json({ error: "Erro ao criar estimate: " + errs });
        }
      } else {
        const data = await gql(`mutation($input: InvoiceCreateInput!) { invoiceCreate(input: $input) { invoice { id invoiceNumber viewUrl } didSucceed inputErrors { message } } }`, { input });
        if (data?.data?.invoiceCreate?.didSucceed) {
          const inv = data.data.invoiceCreate.invoice;
          return res.status(200).json({ success: true, number: inv.invoiceNumber, viewUrl: inv.viewUrl, type: "invoice" });
        } else {
          const errs = data?.data?.invoiceCreate?.inputErrors?.map(e => e.message).join(", ");
          return res.status(400).json({ error: "Erro ao criar invoice: " + errs });
        }
      }
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
