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
  const match = products.find(e => {
    const name = e.node.name.toUpperCase().trim();
    if (name.startsWith('Z ')) return false;
    return name === search || name === searchNoRug || name.includes(search) || name.includes(searchNoRug) || search.includes(name);
  });
  return match?.node?.id || null;
}

export default async function handler(req, res) {
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
