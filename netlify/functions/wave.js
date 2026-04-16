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

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };

  // GET customers
  if (event.httpMethod === "GET" && event.queryStringParameters?.action === "customers") {
    try {
      const data = await gql(`query {
        business(id: "${BUSINESS_ID}") {
          customers(page: 1, pageSize: 200) {
            edges { node { id name } }
          }
        }
      }`, {});
      const customers = data?.data?.business?.customers?.edges?.map(e => e.node) || [];
      return { statusCode: 200, headers, body: JSON.stringify({ customers }) };
    } catch (e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  // POST create invoice or estimate
  if (event.httpMethod === "POST") {
    try {
      const { customerId, items, docType } = JSON.parse(event.body);

      if (!customerId || !items || items.length === 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Dados incompletos." }) };
      }

      // Find existing products in Wave by name
      const formattedItems = [];
      for (const item of items) {
        const productName = item.name;
        // Build description lines
        const lines = [];
        if (item.measurements) lines.push("Measurements: " + item.measurements);
        if (item.shape && item.shape !== "Rectangular") lines.push("Shape: " + item.shape);
        if (item.color) lines.push("Color: " + item.color);
        if (item.finishing) lines.push("Finishing: " + item.finishing);
        if (item.sku) lines.push("SKU: " + item.sku);
        const description = lines.join("\n");

        // Search for existing product
        const searchData = await gql(`query {
          business(id: "${BUSINESS_ID}") {
            products(page: 1, pageSize: 50) {
              edges { node { id name } }
            }
          }
        }`, {});

        const products = searchData?.data?.business?.products?.edges || [];
        const match = products.find(e => e.node.name.toUpperCase().includes(item.name.replace(' RUG','').toUpperCase()) || e.node.name.toUpperCase() === item.name.toUpperCase());
        const productId = match?.node?.id;

        if (!productId) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Produto não encontrado no Wave: " + item.name + " | Produtos disponíveis: " + products.map(e=>e.node.name).join(', ') }) };
        }

        formattedItems.push({
          productId,
          quantity: String(item.quantity),
          unitPrice: String(parseFloat(item.price).toFixed(2)),
          description
        });
      }

      if (docType === "estimate") {
        const data = await gql(`mutation {
          estimateCreate(input: {
            businessId: "${BUSINESS_ID}",
            customerId: "${customerId}",
            items: ${JSON.stringify(formattedItems)}
          }) {
            estimate { id estimateNumber viewUrl }
            didSucceed
            inputErrors { message }
          }
        }`, {});

        if (data?.data?.estimateCreate?.didSucceed) {
          const est = data.data.estimateCreate.estimate;
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, number: est.estimateNumber, viewUrl: est.viewUrl, type: "estimate" }) };
        } else {
          const errs = data?.data?.estimateCreate?.inputErrors?.map(e => e.message).join(", ");
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Erro ao criar estimate: " + errs + " | debug: " + JSON.stringify(data) }) };
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
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, number: inv.invoiceNumber, viewUrl: inv.viewUrl, type: "invoice" }) };
        } else {
          const errs = data?.data?.invoiceCreate?.inputErrors?.map(e => e.message).join(", ");
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Erro ao criar invoice: " + errs + " | debug: " + JSON.stringify(data) }) };
        }
      }
    } catch (e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
};
