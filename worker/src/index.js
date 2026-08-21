const ML = "https://api.mercadolibre.com";

const ORDERS = new Set([
  "stop_time_asc",
  "stop_time_desc",
  "start_time_asc",
  "start_time_desc",
  "available_quantity_asc",
  "available_quantity_desc",
  "sold_quantity_asc",
  "sold_quantity_desc",
  "price_asc",
  "price_desc",
  "last_updated_desc",
  "last_updated_asc",
  "total_sold_quantity_asc",
  "total_sold_quantity_desc"
]);

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Content-Type": "application/json;charset=utf-8"
};

const out = (x, s = 200) =>
  new Response(JSON.stringify(x), {
    status: s,
    headers
  });

const reqenv = (e, k) => {
  if (!e[k]) {
    throw Error(`Secret ${k} não configurado.`);
  }

  return e[k];
};

async function getStore(env, sellerId) {
  const key = `store:${sellerId}`;

  const saved = await env.ML_STORES.get(key, "json");

  if (saved) {
    return saved;
  }

  // Migração da loja atual usando os Secrets existentes.
  const configuredSellerId = reqenv(env, "ML_SELLER_ID");

  if (sellerId !== configuredSellerId) {
    throw Error("Loja não encontrada.");
  }

  const store = {
    seller_id: sellerId,
    name: env.ML_STORE_NAME || "Loja Mercado Livre",
    logo_url: env.ML_STORE_LOGO_URL || "",
    refresh_token: reqenv(env, "ML_REFRESH_TOKEN"),
    access_token: null,
    expires_at: 0,
    active: true
  };

  await env.ML_STORES.put(key, JSON.stringify(store));

  return store;
}

async function saveStore(env, store) {
  const key = `store:${store.seller_id}`;

  await env.ML_STORES.put(
    key,
    JSON.stringify(store)
  );

  return store;
}

async function getAccessToken(env, sellerId) {
  const store = await getStore(env, sellerId);

  const now = Date.now();

  // Reutiliza o access token enquanto ainda estiver válido.
  if (
    store.access_token &&
    store.expires_at &&
    now < store.expires_at - 60000
  ) {
    return store.access_token;
  }

  const form = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: reqenv(env, "ML_CLIENT_ID"),
    client_secret: reqenv(env, "ML_CLIENT_SECRET"),
    refresh_token: store.refresh_token
  });

  const response = await fetch(`${ML}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw Error(
      `OAuth ${response.status}: ${
        data.message ||
        data.error ||
        "erro ao renovar token"
      }`
    );
  }

  store.access_token = data.access_token;

  store.expires_at =
    Date.now() +
    Number(data.expires_in || 21600) * 1000;

  // O Mercado Livre pode fornecer um novo refresh token.
  if (data.refresh_token) {
    store.refresh_token = data.refresh_token;
  }

  await saveStore(env, store);

  return store.access_token;
}

async function ml(path, accessToken, extraHeaders = {}) {
  const response = await fetch(`${ML}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...extraHeaders
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok && response.status !== 206) {
    throw Error(
      `Mercado Livre ${response.status}: ${
        data.message || data.error || "erro"
      }`
    );
  }

  return data;
}

/*
 * Retorna o status logístico de um shipment.
 *
 * O Mercado Livre atualmente separa os dados de Orders
 * dos dados de Shipments.
 */
async function getShipment(shipmentId, accessToken) {
  if (!shipmentId) {
    return null;
  }

  try {
    return await ml(
      `/shipments/${encodeURIComponent(shipmentId)}`,
      accessToken,
      {
        "x-format-new": "true"
      }
    );
  } catch {
    return null;
  }
}

/*
 * Converte o status do shipment em uma classificação
 * simples para o nosso dashboard.
 */
function classifyShipping(shipment) {
  if (!shipment) {
    return "no_shipping";
  }

  const status = shipment.status;
  const substatus = shipment.substatus;

  if (status === "cancelled") {
    return "cancelled";
  }

  if (status === "delivered") {
    return "delivered";
  }

  if (
    status === "shipped" ||
    status === "in_transit" ||
    status === "out_for_delivery"
  ) {
    return "shipped";
  }

  if (
    status === "ready_to_ship" ||
    status === "handling" ||
    status === "pending"
  ) {
    return "pending_shipping";
  }

  /*
   * Alguns fluxos usam substatus para indicar
   * que o pacote já foi coletado.
   */
  if (
    ["picked_up", "authorized_by_carrier", "in_hub"].includes(substatus)
  ) {
    return "shipped";
  }

  return "other";
}

function localDateKey(date) {
  const d = new Date(date);

  if (Number.isNaN(d.getTime())) {
    return null;
  }

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function lastSevenDays() {
  const result = [];
  const now = new Date();

  for (let i = 6; i >= 0; i--) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - i);

    result.push({
      date: localDateKey(date),
      sales: 0,
      revenue: 0,
      cancelled: 0
    });
  }

  return result;
}

function orderRevenue(order) {
  const value = Number(order.total_amount);

  if (Number.isFinite(value)) {
    return value;
  }

  return (order.order_items || []).reduce((total, item) => {
    return total + Number(item.unit_price || 0) * Number(item.quantity || 0);
  }, 0);
}

async function getOrdersSummary(sellerId, accessToken) {
  const days = lastSevenDays();

  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - 6);

  const to = new Date();

  const allOrders = [];
  let offset = 0;
  const limit = 50;
  let total = null;

  /*
   * Busca todas as páginas de pedidos.
   *
   * Exemplo:
   * 344 pedidos
   * 50 + 50 + 50 + 50 + 50 + 50 + 44
   */
  do {
    const searchParams = new URLSearchParams({
      seller: sellerId,
      "order.date_created.from": from.toISOString(),
      "order.date_created.to": to.toISOString(),
      sort: "date_desc",
      limit: String(limit),
      offset: String(offset)
    });

    const search = await ml(
      `/orders/search?${searchParams.toString()}`,
      accessToken
    );

    const orders = search.results || [];

    allOrders.push(...orders);

    total = Number(search.paging?.total || allOrders.length);

    offset += orders.length;

    /*
     * Segurança para evitar loop infinito
     * caso a API retorne uma página vazia.
     */
    if (orders.length === 0) {
      break;
    }

    /*
     * Limite de segurança.
     * Não deixamos o Worker fazer requisições indefinidamente.
     */
    if (offset >= total) {
      break;
    }

  } while (offset < total);

  const summary = {
    sales: 0,
    revenue: 0,
    cancelled: 0,
    pending_shipping: 0,
    shipped: 0,
    delivered: 0,
    other: 0
  };

  /*
   * Buscamos os shipments em pequenos lotes.
   */
  const enrichedOrders = [];

  for (let i = 0; i < allOrders.length; i += 5) {
    const batch = allOrders.slice(i, i + 5);

    const enriched = await Promise.all(
      batch.map(async (order) => {
        const shipmentId = order.shipping?.id;

        const shipment = shipmentId
          ? await getShipment(shipmentId, accessToken)
          : null;

        const shippingStatus = classifyShipping(shipment);

        return {
          order,
          shipment,
          shippingStatus
        };
      })
    );

    enrichedOrders.push(...enriched);
  }

  /*
   * Processa todos os pedidos.
   */
  for (const entry of enrichedOrders) {
    const order = entry.order;
    const shippingStatus = entry.shippingStatus;

    const paymentApproved = (order.payments || []).some(
      (payment) => payment.status === "approved"
    );

    const isPaid =
      order.status === "paid" ||
      order.status === "partially_paid" ||
      paymentApproved;

    if (isPaid) {
      summary.sales += 1;
      summary.revenue += orderRevenue(order);
    }

    /*
     * Cancelamentos.
     */
    if (
      order.status === "cancelled" ||
      order.status === "pending_cancel"
    ) {
      summary.cancelled += 1;
    }

    /*
     * Situação do envio.
     */
    if (shippingStatus === "pending_shipping") {
      summary.pending_shipping += 1;
    } else if (shippingStatus === "shipped") {
      summary.shipped += 1;
    } else if (shippingStatus === "delivered") {
      summary.delivered += 1;
    } else if (shippingStatus === "other") {
      summary.other += 1;
    }

    /*
     * Gráfico dos últimos 7 dias.
     */
    if (isPaid) {
      const date = localDateKey(
        order.date_closed ||
        order.date_created
      );

      const day = days.find(
        (item) => item.date === date
      );

      if (day) {
        day.sales += 1;
        day.revenue += orderRevenue(order);
      }
    }
    const isCancelled =
  order.status === "cancelled" ||
  order.status === "pending_cancel";

if (isCancelled) {
  const date = localDateKey(
    order.date_closed ||
    order.date_created
  );

  const day = days.find(
    (item) => item.date === date
  );

  if (day) {
    day.cancelled += 1;
  }
}
  }

  /*
   * Corrige pequenos erros de ponto flutuante:
   *
   * 6885.600000000002
   *
   * vira:
   *
   * 6885.60
   */
  summary.revenue = Number(
    summary.revenue.toFixed(2)
  );

  days.forEach((day) => {
    day.revenue = Number(
      day.revenue.toFixed(2)
    );
  });

  return {
    seller_id: sellerId,

    period: {
      days: 7,
      from: from.toISOString(),
      to: to.toISOString()
    },

    summary,

    daily: days,

    orders_found: allOrders.length,

    paging: {
      total,
      offset: 0,
      limit
    }
  };
}


async function createStore(env, data) {
  const sellerId = String(data.seller_id || "").trim();
  const name = String(data.name || "").trim();
  const logoUrl = String(data.logo_url || "").trim();
  const refreshToken = String(data.refresh_token || "").trim();

  if (!sellerId) {
    throw Error("seller_id é obrigatório.");
  }

  if (!name) {
    throw Error("name é obrigatório.");
  }

  if (!refreshToken) {
    throw Error("refresh_token é obrigatório.");
  }

  const key = `store:${sellerId}`;

  const existing = await env.ML_STORES.get(key, "json");

  if (existing) {
    throw Error("Esta loja já está cadastrada.");
  }

  const form = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: reqenv(env, "ML_CLIENT_ID"),
    client_secret: reqenv(env, "ML_CLIENT_SECRET"),
    refresh_token: refreshToken
  });

  const response = await fetch(`${ML}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form
  });

  const oauth = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw Error(
      `Não foi possível conectar a loja: ${
        oauth.message ||
        oauth.error ||
        `OAuth ${response.status}`
      }`
    );
  }

  const store = {
    seller_id: sellerId,
    name,
    logo_url: logoUrl,
    refresh_token: oauth.refresh_token || refreshToken,
    access_token: oauth.access_token,
    expires_at:
      Date.now() +
      Number(oauth.expires_in || 21600) * 1000,
    active: true
  };

  await env.ML_STORES.put(
    key,
    JSON.stringify(store)
  );

  return {
    id: sellerId,
    seller_id: sellerId,
    name,
    logo_url: logoUrl,
    active: true
  };
}


export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers
      });
    }

    try {
      const url = new URL(request.url);
if (
  url.pathname === "/api/stores" &&
  request.method === "POST"
) {
  try {
    const data = await request.json();

    const store = await createStore(
      env,
      data
    );

    return out({
      success: true,
      store
    }, 201);

  } catch (error) {
    return out({
      error: error.message || "Erro ao cadastrar loja."
    }, 400);
  }
}
      if (
  url.pathname === "/api/stores" &&
  request.method === "GET"
) {
  const sellerId = reqenv(env, "ML_SELLER_ID");

  const store = await getStore(
    env,
    sellerId
  );

  return out({
    stores: [
      {
        id: store.seller_id,
        seller_id: store.seller_id,
        name: store.name,
        logo_url: store.logo_url || "",
        active: store.active !== false
      }
    ]
  });
}

      /*
       * ANÚNCIOS
       */
      const itemsMatch = url.pathname.match(
        /^\/api\/stores\/([^/]+)\/items$/
      );

      if (itemsMatch && request.method === "GET") {
        const id = itemsMatch[1];

        if (id !== reqenv(env, "ML_SELLER_ID")) {
          return out(
            {
              error: "Loja não encontrada."
            },
            404
          );
        }

        const order =
          url.searchParams.get("order") ||
          "sold_quantity_desc";

        if (!ORDERS.has(order)) {
          return out(
            {
              error: "Ordenação inválida."
            },
            400
          );
        }

        const offset = Math.max(
          0,
          Number(url.searchParams.get("offset") || 0)
        );

        const limit = Math.min(
          50,
          Math.max(
            1,
            Number(url.searchParams.get("limit") || 24)
          )
        );

        const accessToken = await getAccessToken(env, id);

        const params = new URLSearchParams({
          orders: order,
          offset: String(offset),
          limit: String(limit)
        });

        const search = await ml(
          `/users/${encodeURIComponent(
            id
          )}/items/search?${params.toString()}`,
          accessToken
        );

        const ids = search.results || [];
        const items = [];

        for (let i = 0; i < ids.length; i += 5) {
          const batch = ids.slice(i, i + 5);

          items.push(
            ...await Promise.all(
              batch.map((itemId) =>
                ml(
                  `/items/${encodeURIComponent(itemId)}`,
                  accessToken
                )
              )
            )
          );
        }

        return out({
          seller_id: id,
          items,
          paging:
            search.paging || {
              limit,
              offset,
              total: items.length
            },
          orders: search.orders || [],
          available_orders:
            search.available_orders || []
        });
      }

      /*
       * VENDAS / PEDIDOS — ÚLTIMOS 7 DIAS
       */
      const ordersMatch = url.pathname.match(
        /^\/api\/stores\/([^/]+)\/orders$/
      );

      if (ordersMatch && request.method === "GET") {
        const id = ordersMatch[1];

        if (id !== reqenv(env, "ML_SELLER_ID")) {
          return out(
            {
              error: "Loja não encontrada."
            },
            404
          );
        }

        const accessToken = await getAccessToken(env, id);

        const result = await getOrdersSummary(
          id,
          accessToken
        );

        return out(result);
      }

      return out(
        {
          error: "Rota não encontrada."
        },
        404
      );
    } catch (error) {
      return out(
        {
          error: error.message || "Erro interno"
        },
        500
      );
    }
  }
};
