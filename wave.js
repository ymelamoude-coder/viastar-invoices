const WAVE_TOKEN = "EW7tDC2BxTPFUmzxbtNrBABv2GBCGV";
const BUSINESS_ID = "QnVzaW5lc3M6NGM3ZGVjM2EtYWY3My00ZTlmLTk4MGItNjhiM2Q3M2RkZTEw";

async function gql(query, variables) {
  const res = await fetch("https://gql.waveapps.com/graphql/public", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + WAVE_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") return res.status(200).end();

  // GET customers
  if (req.method === "GET" && req.query.action === "customers") {
    try {
      const data = await gql(`query {
        business(id: "${BUSINESS_ID}") {
          customers(page: 1, pageSize: 200) {
            edges { node { id name } }
          }
        }
      }`, {});
      const customers = data?.data?.business?.customers?.edges?.map(e => e.node) || [];
      return res.status(200).json({ customers });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST create invoice or estimate
  if (req.method === "POST") {
    try {
      const { customerId, items, docType } = req.body;

      if (!customerId || !items || items.length === 0) {
        return res.status(400).json({ error: "Dados incompletos." });
      }

      const formattedItems = [];
      for (const item of items) {
        const productName = item.name;
        const description = "Measurements: " + item.measurements +
              (item.shape && item.shape !== "Rectangular" ? "\nShape: " + item.shape : "") +
              "\nColor: " + item.color +
              "\nFinishing: " + item.finishing +
              "\nSKU: " + item.sku;

        const searchData = await gql(`query {
          business(id: "${BUSINESS_ID}") {
            products(page: 1, pageSize: 200) {
              edges { node { id name } }
            }
          }
        }`, {});

        const products = searchData?.data?.business?.products?.edges || [];
        const searchName = item.name.toUpperCase().trim();
        const searchNameNoRug = searchName.replace(' RUG', '').trim();
        const match = products.find(e => {
          const name = e.node.name.toUpperCase().trim();
          if (name.startsWith('Z ')) return false;
          return name === searchName ||
                 name === searchNameNoRug ||
                 name.includes(searchName) ||
                 name.includes(searchNameNoRug) ||
                 searchName.includes(name);
        });
        const productId = match?.node?.id;

        if (!productId) {
          return res.status(400).json({ error: "Produto não encontrado: " + item.name + " | Disponíveis: " + products.map(e => e.node.name).join(', ') });
        }

        formattedItems.push({
          productId,
          quantity: String(item.quantity),
          unitPrice: String(parseFloat(item.price).toFixed(2)),
          description
        });
      }

      if (docType === "estimate") {
        // Check EstimateCreateItemInput fields
        const introData = await gql(`query GetType($name: String!) { __type(name: $name) { inputFields { name type { name kind ofType { name } } } } }`, { name: "EstimateCreateItemInput" });
        const fields = introData?.data?.__type?.inputFields?.map(f => f.name) || [];
        
        // Build items based on available fields
        const estimateItems = formattedItems.map(item => {
          const i = { productId: item.productId, quantity: item.quantity };
          if (fields.includes('unitPrice')) i.unitPrice = item.unitPrice;
          if (fields.includes('unitAmount')) i.unitAmount = item.unitPrice;
          if (fields.includes('description')) i.description = item.description;
          return i;
        });

        // Try with minimal input first
        const estimateInput = { 
          businessId: BUSINESS_ID, 
          customerId, 
          items: estimateItems.map(i => ({
            productId: i.productId,
            quantity: parseFloat(i.quantity),
            unitPrice: parseFloat(i.unitPrice)
          }))
        };
        
        const data = await gql(`mutation($input: EstimateCreateInput!) {
          estimateCreate(input: $input) {
            estimate { id estimateNumber viewUrl }
            didSucceed
            inputErrors { message }
          }
        }`, { input: estimateInput });

        if (data?.data?.estimateCreate?.didSucceed) {
          const est = data.data.estimateCreate.estimate;
          return res.status(200).json({ success: true, number: est.estimateNumber, viewUrl: est.viewUrl, type: "estimate" });
        } else {
          return res.status(400).json({ 
            error: "Erro estimate", 
            sentInput: JSON.stringify(estimateInput),
            waveResponse: JSON.stringify(data) 
          });
        }
      } else {
        const data = await gql(`mutation($input: InvoiceCreateInput!) {
          invoiceCreate(input: $input) {
            invoice { id invoiceNumber viewUrl }
            didSucceed
            inputErrors { message }
          }
        }`, { input: { businessId: BUSINESS_ID, customerId, items: formattedItems } });

        if (data?.data?.invoiceCreate?.didSucceed) {
          const inv = data.data.invoiceCreate.invoice;
          return res.status(200).json({ success: true, number: inv.invoiceNumber, viewUrl: inv.viewUrl, type: "invoice" });
        } else {
          const errs = data?.data?.invoiceCreate?.inputErrors?.map(e => e.message).join(", ");
          return res.status(400).json({ error: "Erro ao criar invoice: " + errs });
        }
      }
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
