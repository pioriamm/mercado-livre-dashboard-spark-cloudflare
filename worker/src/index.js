const ML = "https://api.mercadolibre.com";

const ML_REDIRECT_URI =
  "https://mercado-livre-dashboard-api.mercado-livre-marcelo.workers.dev/api/oauth/callback";

const FRONTEND_URL =
  "https://pioriamm.github.io/mercado-livre-dashboard-spark-cloudflare/";

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
  "total_sold_quantity_desc",
]);

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Content-Type": "application/json;charset=utf-8",
};

const out = (data, status = 200) => {
  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
};

const reqenv = (env, key) => {
  if (!env[key]) {
    throw new Error(`Secret ${key} não configurado.`);
  }

  return env[key];
};

/* =========================================================
   STORE
========================================================= */

async function getStore(env, sellerId) {
  const id = String(sellerId || "").trim();

  if (!id) {
    throw new Error("seller_id não informado.");
  }

  const key = `store:${id}`;

  const saved = await env.ML_STORES.get(key, "json");

  if (saved) {
    return saved;
  }

  const configuredSellerId = env.ML_SELLER_ID;

  if (!configuredSellerId || String(configuredSellerId) !== id) {
    throw new Error("Loja não encontrada.");
  }

  const refreshToken = reqenv(env, "ML_REFRESH_TOKEN");

  const store = {
    seller_id: id,

    name: env.ML_STORE_NAME || "Loja Mercado Livre",

    logo_url: env.ML_STORE_LOGO_URL || "",

    refresh_token: refreshToken,

    access_token: null,

    expires_at: 0,

    active: true,
  };

  await env.ML_STORES.put(key, JSON.stringify(store));

  return store;
}

async function saveStore(env, store) {
  const key = `store:${store.seller_id}`;

  await env.ML_STORES.put(key, JSON.stringify(store));

  return store;
}

async function listStores(env) {
  if (env.ML_SELLER_ID) {
    try {
      await getStore(env, env.ML_SELLER_ID);
    } catch {
      // Continua listando as lojas existentes no KV.
    }
  }

  const stores = [];

  let cursor;

  do {
    const result = await env.ML_STORES.list({
      prefix: "store:",
      cursor,
    });

    for (const key of result.keys) {
      const store = await env.ML_STORES.get(key.name, "json");

      if (store && store.seller_id) {
        if (!store.logo_url && store.access_token) {
          try {
            const user = await ml(
              `/users/${encodeURIComponent(store.seller_id)}`,
              store.access_token,
            );

            if (user && user.logo) {
              store.logo_url = user.logo;

              await saveStore(env, store);
            }
          } catch (error) {
            console.error(
              `Erro ao buscar logo da loja ${store.seller_id}:`,
              error,
            );
          }
        }

        stores.push({
          id: store.seller_id,

          seller_id: store.seller_id,

          name: store.name || "Loja Mercado Livre",

          logo_url: store.logo_url || "",

          active: store.active !== false,
        });
      }
    }

    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);

  const unique = new Map();

  for (const store of stores) {
    unique.set(String(store.seller_id), store);
  }

  return Array.from(unique.values());
}

/* =========================================================
   ACCESS TOKEN
========================================================= */

async function getAccessToken(env, sellerId) {
  const store = await getStore(env, sellerId);

  const now = Date.now();

  if (
    store.access_token &&
    store.expires_at &&
    now < Number(store.expires_at) - 60000
  ) {
    return store.access_token;
  }

  const form = new URLSearchParams({
    grant_type: "refresh_token",

    client_id: reqenv(env, "ML_CLIENT_ID"),

    client_secret: reqenv(env, "ML_CLIENT_SECRET"),

    refresh_token: store.refresh_token,
  });

  const response = await fetch(`${ML}/oauth/token`, {
    method: "POST",

    headers: {
      "Content-Type": "application/x-www-form-urlencoded",

      Accept: "application/json",
    },

    body: form,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `OAuth ${response.status}: ${
        data.message || data.error || "erro ao renovar token"
      }`,
    );
  }

  store.access_token = data.access_token;

  store.expires_at = Date.now() + Number(data.expires_in || 21600) * 1000;

  if (data.refresh_token) {
    store.refresh_token = data.refresh_token;
  }

  await saveStore(env, store);

  return store.access_token;
}

/* =========================================================
   MERCADO LIVRE API
========================================================= */

async function ml(path, accessToken, extraHeaders = {}) {
  const response = await fetch(`${ML}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,

      Accept: "application/json",

      ...extraHeaders,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok && response.status !== 206) {
    throw new Error(
      `Mercado Livre ${response.status}: ${
        data.message || data.error || "erro"
      }`,
    );
  }

  return data;
}

/* =========================================================
   SHIPMENTS
========================================================= */

async function getShipment(shipmentId, accessToken) {
  if (!shipmentId) {
    return null;
  }

  try {
    return await ml(
      `/shipments/${encodeURIComponent(shipmentId)}`,
      accessToken,
      {
        "x-format-new": "true",
      },
    );
  } catch {
    return null;
  }
}

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

  if (["picked_up", "authorized_by_carrier", "in_hub"].includes(substatus)) {
    return "shipped";
  }

  return "other";
}

/* =========================================================
   DATAS
========================================================= */

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

      cancelled: 0,
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
/* =========================================================
   PEDIDOS
========================================================= */

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

  do {
    const searchParams = new URLSearchParams({
      seller: sellerId,

      "order.date_created.from": from.toISOString(),

      "order.date_created.to": to.toISOString(),

      sort: "date_desc",

      limit: String(limit),

      offset: String(offset),
    });

    const search = await ml(
      `/orders/search?${searchParams.toString()}`,
      accessToken,
    );

    const orders = search.results || [];

    allOrders.push(...orders);

    total = Number(search.paging?.total || allOrders.length);

    offset += orders.length;

    if (orders.length === 0) {
      break;
    }

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

    other: 0,
  };

  const enrichedOrders = [];

  /*
   * Mantemos as chamadas de shipment
   * em pequenos lotes para evitar
   * excesso de subrequests.
   */
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

          shippingStatus,
        };
      }),
    );

    enrichedOrders.push(...enriched);
  }

  for (const entry of enrichedOrders) {
    const order = entry.order;

    const shippingStatus = entry.shippingStatus;

    const paymentApproved = (order.payments || []).some(
      (payment) => payment.status === "approved",
    );

    const isPaid =
      order.status === "paid" ||
      order.status === "partially_paid" ||
      paymentApproved;

    if (isPaid) {
      summary.sales += 1;

      summary.revenue += orderRevenue(order);
    }

    if (order.status === "cancelled" || order.status === "pending_cancel") {
      summary.cancelled += 1;
    }

    if (shippingStatus === "pending_shipping") {
      summary.pending_shipping += 1;
    } else if (shippingStatus === "shipped") {
      summary.shipped += 1;
    } else if (shippingStatus === "delivered") {
      summary.delivered += 1;
    } else if (shippingStatus === "other") {
      summary.other += 1;
    }

    const date = localDateKey(order.date_closed || order.date_created);

    const day = days.find((item) => item.date === date);

    if (day) {
      if (isPaid) {
        day.sales += 1;

        day.revenue += orderRevenue(order);
      }

      if (order.status === "cancelled" || order.status === "pending_cancel") {
        day.cancelled += 1;
      }
    }
  }

  summary.revenue = Number(summary.revenue.toFixed(2));

  days.forEach((day) => {
    day.revenue = Number(day.revenue.toFixed(2));
  });

  return {
    seller_id: sellerId,

    period: {
      days: 7,

      from: from.toISOString(),

      to: to.toISOString(),
    },

    summary,

    daily: days,

    orders_found: allOrders.length,

    paging: {
      total,

      offset: 0,

      limit,
    },
  };
}

/* =========================================================
   FUNÇÕES DO RELATÓRIO
========================================================= */

function reportDate(value, endOfDay = false) {
  const valueText = String(value || "").trim();

  if (!valueText) {
    return null;
  }

  /*
   * A tela envia YYYY-MM-DD.
   *
   * Usamos o horário de Brasília
   * explicitamente para que:
   *
   * 2026-08-31
   *
   * represente o dia inteiro.
   */
  if (/^\d{4}-\d{2}-\d{2}$/.test(valueText)) {
    return new Date(
      `${valueText}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}-03:00`,
    );
  }

  const date = new Date(valueText);

  return Number.isNaN(date.getTime()) ? null : date;
}

function reportItemId(orderItem) {
  return String(orderItem?.item?.id || orderItem?.item_id || "").trim();
}

function reportItemTitle(orderItem) {
  return orderItem?.item?.title || orderItem?.title || "Anúncio sem título";
}

function reportItemUnitPrice(orderItem) {
  const value = Number(
    orderItem?.unit_price ?? orderItem?.full_unit_price ?? 0,
  );

  return Number.isFinite(value) ? value : 0;
}

function reportItemQuantity(orderItem) {
  const value = Number(orderItem?.quantity || 0);

  return Number.isFinite(value) ? value : 0;
}

function reportIsCancelled(order) {
  return order?.status === "cancelled" || order?.status === "pending_cancel";
}

function reportIsPaid(order) {
  if (reportIsCancelled(order)) {
    return false;
  }

  if (order?.status === "paid" || order?.status === "partially_paid") {
    return true;
  }

  return (order?.payments || []).some(
    (payment) => payment?.status === "approved",
  );
}

/* =========================================================
   BUSCAR PEDIDOS DO PERÍODO
========================================================= */

async function fetchReportOrders(
  sellerId,
  accessToken,
  from,
  to,
  offset = 0,
  limit = 50,
) {
  /*
   * IMPORTANTE:
   *
   * O Worker não deve buscar todas as páginas
   * de pedidos em uma única execução.
   *
   * Cada chamada ao /orders/search é uma
   * subrequest do Cloudflare.
   *
   * Por isso buscamos somente UMA página.
   *
   * A próxima página será solicitada pelo frontend
   * usando o parâmetro offset.
   */

  const safeOffset = Math.max(0, Number(offset) || 0);

  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 50));

  const params = new URLSearchParams({
    seller: sellerId,

    "order.date_created.from": from.toISOString(),

    "order.date_created.to": to.toISOString(),

    sort: "date_desc",

    limit: String(safeLimit),

    offset: String(safeOffset),
  });

  const result = await ml(`/orders/search?${params.toString()}`, accessToken);

  const orders = Array.isArray(result.results) ? result.results : [];

  const total = Number(result?.paging?.total || 0);

  const nextOffset = safeOffset + orders.length;

  return {
    orders,

    total,

    paging: {
      offset: safeOffset,

      limit: safeLimit,

      total,

      returned: orders.length,

      next_offset: nextOffset,

      has_more: nextOffset < total,
    },
  };
}

/* =========================================================
   BUSCAR IDS DOS ANÚNCIOS
========================================================= */

async function fetchAllSellerItemIds(sellerId, accessToken) {
  const ids = [];

  let scrollId = null;

  /*
   * IMPORTANTE:
   *
   * Aqui NÃO buscamos /items.
   *
   * Pegamos somente os IDs.
   *
   * Isso reduz bastante o número
   * de subrequests.
   */
  while (true) {
    const params = new URLSearchParams({
      search_type: "scan",

      limit: "100",
    });

    if (scrollId) {
      params.set("scroll_id", scrollId);
    }

    const result = await ml(
      `/users/${encodeURIComponent(
        sellerId,
      )}/items/search?${params.toString()}`,
      accessToken,
    );

    const page = Array.isArray(result.results) ? result.results : [];

    ids.push(...page);

    const nextScroll = result.scroll_id || null;

    if (page.length === 0 || !nextScroll || nextScroll === scrollId) {
      break;
    }

    scrollId = nextScroll;
  }

  return [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
}

/* =========================================================
   DETALHES DOS PRODUTOS VENDIDOS
========================================================= */

async function fetchItemsByIds(itemIds, accessToken) {
  const items = [];

  /*
   * Só recebe os IDs dos produtos
   * que realmente apareceram nas vendas.
   *
   * NÃO enviar todos os anúncios
   * da loja aqui.
   */
  for (let i = 0; i < itemIds.length; i += 20) {
    const batch = itemIds.slice(i, i + 20);

    const result = await ml(
      `/items?ids=${batch.map((id) => encodeURIComponent(id)).join(",")}`,
      accessToken,
    );

    if (!Array.isArray(result)) {
      continue;
    }

    for (const entry of result) {
      if (entry?.code !== 200 || !entry.body) {
        continue;
      }

      items.push(entry.body);
    }
  }

  return items;
}
/* =========================================================
   RELATÓRIO DE VENDAS
========================================================= */

function reportMonthKey(date) {
  const d = new Date(date);

  if (Number.isNaN(d.getTime())) {
    return null;
  }

  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}`;
}

function reportMonthLabel(key) {
  if (!key) {
    return "";
  }

  const [year, month] = key.split("-");

  return new Intl.DateTimeFormat("pt-BR", {
    month: "short",

    year: "numeric",

    timeZone: "UTC",
  }).format(new Date(`${year}-${month}-01T12:00:00.000Z`));
}

/*
 * Calcula o relatório.
 *
 * IMPORTANTE:
 *
 * Não buscamos detalhes de todos os
 * anúncios da loja.
 *
 * Primeiro analisamos os pedidos.
 *
 * Só depois buscamos detalhes dos
 * anúncios que realmente tiveram venda.
 */
async function getSalesReport(
  sellerId,
  accessToken,
  from,
  to,
  offset = 0,
  limit = 50,
) {
  const { orders, total, paging } = await fetchReportOrders(
    sellerId,
    accessToken,
    from,
    to,
    offset,
    limit,
  );

  const productMap = new Map();

  const monthlyMap = new Map();

  let paidOrders = 0;
  let cancelledOrders = 0;
  let unitsSold = 0;
  let revenue = 0;

  /*
   * =======================================================
   * PROCESSA OS PEDIDOS
   * =======================================================
   */

  for (const order of orders) {
    if (reportIsCancelled(order)) {
      cancelledOrders += 1;
    }

    if (!reportIsPaid(order)) {
      continue;
    }

    paidOrders += 1;

    const orderTotal = Number(order.total_amount);

    /*
     * Receita do pedido.
     */
    if (Number.isFinite(orderTotal)) {
      revenue += orderTotal;
    }

    /*
     * =====================================================
     * AGRUPAMENTO MENSAL
     * =====================================================
     */

    const month = reportMonthKey(order.date_created);

    if (month) {
      if (!monthlyMap.has(month)) {
        monthlyMap.set(month, {
          month,

          label: reportMonthLabel(month),

          sales: 0,

          units: 0,

          revenue: 0,
        });
      }

      const monthly = monthlyMap.get(month);

      monthly.sales += 1;

      if (Number.isFinite(orderTotal)) {
        monthly.revenue += orderTotal;
      }
    }

    /*
     * =====================================================
     * ITENS DO PEDIDO
     * =====================================================
     */

    for (const orderItem of order.order_items || []) {
      const itemId = reportItemId(orderItem);

      if (!itemId) {
        continue;
      }

      const quantity = reportItemQuantity(orderItem);

      const unitPrice = reportItemUnitPrice(orderItem);

      const itemRevenue = quantity * unitPrice;

      unitsSold += quantity;

      /*
       * Cria o produto somente uma vez.
       */
      if (!productMap.has(itemId)) {
        productMap.set(itemId, {
          item_id: itemId,

          title: reportItemTitle(orderItem),

          sold_quantity: 0,

          revenue: 0,

          orders: 0,

          /*
           * Esses dados podem não estar
           * disponíveis em order_items.
           *
           * Por isso ficam vazios.
           */
          price: unitPrice,

          permalink: "",

          thumbnail: "",

          pictures: [],

          available_quantity: 0,

          sold_quantity_total: 0,

          status: "",
        });
      }

      const product = productMap.get(itemId);

      product.sold_quantity += quantity;

      product.revenue += itemRevenue;

      product.orders += 1;

      /*
       * Mantém o preço mais recente
       * encontrado no pedido.
       */
      if (unitPrice > 0) {
        product.price = unitPrice;
      }

      /*
       * Se o pedido não tiver total_amount,
       * usamos os itens para calcular
       * a receita mensal.
       */
      if (month) {
        const monthly = monthlyMap.get(month);

        monthly.units += quantity;

        if (!Number.isFinite(orderTotal)) {
          monthly.revenue += itemRevenue;
        }
      }
    }
  }

  /*
   * =======================================================
   * NÃO BUSCAR /items AQUI
   * =======================================================
   *
   * Antes fazíamos:
   *
   *   /items?id1,id2,id3...
   *
   * Isso adicionava subrequests ao Worker.
   *
   * Agora o relatório utiliza diretamente
   * os dados existentes em order_items.
   *
   * Isso é suficiente para:
   *
   * - Mais vendidos
   * - Menos vendidos
   * - Maior faturamento
   * - Menor faturamento
   * - Quantidade vendida
   * - Faturamento
   * - Vendas mensais
   */

  const soldItemIds = Array.from(productMap.keys());

  /*
   * =======================================================
   * PRODUTOS
   * =======================================================
   */

  const products = Array.from(productMap.values());

  for (const product of products) {
    product.revenue = Number(product.revenue.toFixed(2));
  }

  /*
   * =======================================================
   * VALORES MENSAIS
   * =======================================================
   */

  for (const month of monthlyMap.values()) {
    month.revenue = Number(month.revenue.toFixed(2));
  }

  /*
   * =======================================================
   * ORDENAÇÕES
   * =======================================================
   */

  const sortDesc = (a, b) => {
    if (b.sold_quantity !== a.sold_quantity) {
      return b.sold_quantity - a.sold_quantity;
    }

    return b.revenue - a.revenue;
  };

  const sortAsc = (a, b) => {
    if (a.sold_quantity !== b.sold_quantity) {
      return a.sold_quantity - b.sold_quantity;
    }

    return a.revenue - b.revenue;
  };

  const byRevenueDesc = (a, b) =>
    b.revenue - a.revenue || b.sold_quantity - a.sold_quantity;

  const byRevenueAsc = (a, b) =>
    a.revenue - b.revenue || a.sold_quantity - b.sold_quantity;

  /*
   * =======================================================
   * MAIS / MENOS VENDIDOS
   * =======================================================
   */

  const mostSold = [...products].sort(sortDesc).slice(0, 20);

  const leastSold = [...products].sort(sortAsc).slice(0, 20);

  /*
   * =======================================================
   * MAIOR / MENOR FATURAMENTO
   * =======================================================
   */

  const highestRevenue = [...products].sort(byRevenueDesc).slice(0, 20);

  const lowestRevenue = [...products].sort(byRevenueAsc).slice(0, 20);

  /*
   * =======================================================
   * VENDAS POR MÊS
   * =======================================================
   */

  const monthly = Array.from(monthlyMap.values()).sort((a, b) =>
    a.month.localeCompare(b.month),
  );

  /*
   * =======================================================
   * RETORNO
   * =======================================================
   */

  return {
    seller_id: sellerId,

    period: {
      from: from.toISOString(),

      to: to.toISOString(),
    },

    summary: {
      orders: paidOrders,

      sales: paidOrders,

      units_sold: unitsSold,

      revenue: Number(revenue.toFixed(2)),

      cancelled: cancelledOrders,

      /*
       * Aqui temos somente os produtos
       * que tiveram venda no período.
       */
      items_with_sales: products.length,

      /*
       * Não calculamos estes dois campos
       * aqui porque isso exigiria percorrer
       * todos os anúncios da loja.
       *
       * Será feito posteriormente através
       * de uma rota paginada específica.
       */
      items_without_sales: null,

      items_total: null,

      orders_found: orders.length,

      orders_total: total,

      paging: {
        offset: paging.offset,

        limit: paging.limit,

        total: paging.total,

        returned: paging.returned,

        next_offset: paging.next_offset,

        has_more: paging.has_more,
      },
    },

    monthly,

    most_sold: mostSold,

    least_sold: leastSold,

    highest_revenue: highestRevenue,

    lowest_revenue: lowestRevenue,

    /*
     * Sem vendas será implementado
     * em endpoint separado.
     */
    no_sales: {
      total: null,

      item_ids: [],
    },

    no_sales_total: null,
    products: products,
    items_total: null,
  };
}
/* =========================================================
   OAUTH START
========================================================= */

async function oauthStart(env) {
  const clientId = reqenv(env, "ML_CLIENT_ID");

  const state = crypto.randomUUID();

  await env.ML_STORES.put(
    `oauth:state:${state}`,
    JSON.stringify({
      created_at: Date.now(),
    }),
    {
      expirationTtl: 600,
    },
  );

  const authUrl = new URL("https://auth.mercadolivre.com.br/authorization");

  authUrl.searchParams.set("response_type", "code");

  authUrl.searchParams.set("client_id", clientId);

  authUrl.searchParams.set("redirect_uri", ML_REDIRECT_URI);

  authUrl.searchParams.set("state", state);

  return Response.redirect(authUrl.toString(), 302);
}

/* =========================================================
   OAUTH CALLBACK
========================================================= */

async function oauthCallback(request, env) {
  const url = new URL(request.url);

  const code = url.searchParams.get("code");

  const state = url.searchParams.get("state");

  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return Response.redirect(
      `${FRONTEND_URL}?oauth_error=${encodeURIComponent(oauthError)}`,
      302,
    );
  }

  if (!code) {
    return Response.redirect(`${FRONTEND_URL}?oauth_error=no_code`, 302);
  }

  if (!state) {
    return Response.redirect(`${FRONTEND_URL}?oauth_error=no_state`, 302);
  }

  const stateKey = `oauth:state:${state}`;

  const savedState = await env.ML_STORES.get(stateKey);

  if (!savedState) {
    return Response.redirect(`${FRONTEND_URL}?oauth_error=invalid_state`, 302);
  }

  await env.ML_STORES.delete(stateKey);

  const form = new URLSearchParams({
    grant_type: "authorization_code",

    client_id: reqenv(env, "ML_CLIENT_ID"),

    client_secret: reqenv(env, "ML_CLIENT_SECRET"),

    code,

    redirect_uri: ML_REDIRECT_URI,
  });

  const response = await fetch(`${ML}/oauth/token`, {
    method: "POST",

    headers: {
      Accept: "application/json",

      "Content-Type": "application/x-www-form-urlencoded",
    },

    body: form,
  });

  const token = await response.json().catch(() => ({}));

  if (!response.ok) {
    return Response.redirect(
      `${FRONTEND_URL}?oauth_error=${encodeURIComponent(
        token.message || token.error || `oauth_${response.status}`,
      )}`,
      302,
    );
  }

  const sellerId = String(token.user_id || "").trim();

  if (!sellerId) {
    return Response.redirect(`${FRONTEND_URL}?oauth_error=no_user_id`, 302);
  }

  let user = {};

  try {
    user = await ml(
      `/users/${encodeURIComponent(sellerId)}`,
      token.access_token,
    );
  } catch {
    user = {};
  }

  const existing = await env.ML_STORES.get(`store:${sellerId}`, "json");

  const store = {
    seller_id: sellerId,

    name:
      user.nickname || user.first_name || existing?.name || `Loja ${sellerId}`,

    logo_url: user.logo || existing?.logo_url || "",

    refresh_token: token.refresh_token || existing?.refresh_token || "",

    access_token: token.access_token || null,

    expires_at: Date.now() + Number(token.expires_in || 21600) * 1000,

    active: true,
  };

  if (!store.refresh_token) {
    return Response.redirect(
      `${FRONTEND_URL}?oauth_error=no_refresh_token`,
      302,
    );
  }

  await saveStore(env, store);

  return Response.redirect(`${FRONTEND_URL}?oauth=success`, 302);
}

/* =========================================================
   CREATE STORE
========================================================= */

async function createStore(env, data) {
  const sellerId = String(data.seller_id || "").trim();

  const name = String(data.name || "").trim();

  const logoUrl = String(data.logo_url || "").trim();

  const refreshToken = String(data.refresh_token || "").trim();

  if (!sellerId) {
    throw new Error("seller_id é obrigatório.");
  }

  if (!name) {
    throw new Error("name é obrigatório.");
  }

  if (!refreshToken) {
    throw new Error("refresh_token é obrigatório.");
  }

  const key = `store:${sellerId}`;

  const existing = await env.ML_STORES.get(key, "json");

  if (existing) {
    throw new Error("Esta loja já está cadastrada.");
  }

  const form = new URLSearchParams({
    grant_type: "refresh_token",

    client_id: reqenv(env, "ML_CLIENT_ID"),

    client_secret: reqenv(env, "ML_CLIENT_SECRET"),

    refresh_token: refreshToken,
  });

  const response = await fetch(`${ML}/oauth/token`, {
    method: "POST",

    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },

    body: form,
  });

  const oauth = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `Não foi possível conectar a loja: ${
        oauth.message || oauth.error || `OAuth ${response.status}`
      }`,
    );
  }

  const store = {
    seller_id: sellerId,

    name,

    logo_url: logoUrl,

    refresh_token: oauth.refresh_token || refreshToken,

    access_token: oauth.access_token || null,

    expires_at: Date.now() + Number(oauth.expires_in || 21600) * 1000,

    active: true,
  };

  await env.ML_STORES.put(key, JSON.stringify(store));

  return store;
}

/* =========================================================
   WORKER
========================================================= */

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,

        headers,
      });
    }

    try {
      const url = new URL(request.url);

      /* =====================================================
         OAUTH START
      ===================================================== */

      if (url.pathname === "/api/oauth/start" && request.method === "GET") {
        return oauthStart(env);
      }

      /* =====================================================
         OAUTH CALLBACK
      ===================================================== */

      if (url.pathname === "/api/oauth/callback" && request.method === "GET") {
        return oauthCallback(request, env);
      }

      /* =====================================================
         LISTAR LOJAS
      ===================================================== */

      if (url.pathname === "/api/stores" && request.method === "GET") {
        const stores = await listStores(env);

        return out({
          stores,
        });
      }

      /* =====================================================
         CADASTRAR LOJA
      ===================================================== */

      if (url.pathname === "/api/stores" && request.method === "POST") {
        try {
          const data = await request.json();

          const store = await createStore(env, data);

          return out(
            {
              success: true,

              store,
            },
            201,
          );
        } catch (error) {
          return out(
            {
              error: error.message || "Erro ao cadastrar loja.",
            },
            400,
          );
        }
      }

      /* =====================================================
         ANÚNCIOS
      ===================================================== */

      const itemsMatch = url.pathname.match(/^\/api\/stores\/([^/]+)\/items$/);

      if (itemsMatch && request.method === "GET") {
        const sellerId = decodeURIComponent(itemsMatch[1]);

        const order = url.searchParams.get("order") || "sold_quantity_desc";

        if (!ORDERS.has(order)) {
          return out(
            {
              error: "Ordenação inválida.",
            },
            400,
          );
        }

        const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));

        const limit = Math.min(
          50,
          Math.max(1, Number(url.searchParams.get("limit") || 24)),
        );

        const accessToken = await getAccessToken(env, sellerId);

        const params = new URLSearchParams({
          orders: order,

          offset: String(offset),

          limit: String(limit),
        });

        const search = await ml(
          `/users/${encodeURIComponent(
            sellerId,
          )}/items/search?${params.toString()}`,
          accessToken,
        );

        const ids = search.results || [];

        const items = [];

        /*
         * Mantém o comportamento
         * atual da tela de anúncios.
         */
        for (let i = 0; i < ids.length; i += 5) {
          const batch = ids.slice(i, i + 5);

          const batchItems = await Promise.all(
            batch.map((itemId) =>
              ml(`/items/${encodeURIComponent(itemId)}`, accessToken),
            ),
          );

          items.push(...batchItems);
        }

        return out({
          seller_id: sellerId,

          items,

          paging: search.paging || {
            limit,

            offset,

            total: items.length,
          },

          orders: search.orders || [],

          available_orders: search.available_orders || [],
        });
      }

      /* =====================================================
         PEDIDOS
      ===================================================== */

      const ordersMatch = url.pathname.match(
        /^\/api\/stores\/([^/]+)\/orders$/,
      );

      if (ordersMatch && request.method === "GET") {
        const sellerId = decodeURIComponent(ordersMatch[1]);

        await getStore(env, sellerId);

        const accessToken = await getAccessToken(env, sellerId);

        const summary = await getOrdersSummary(sellerId, accessToken);

        return out(summary);
      }

      /* =====================================================
         RELATÓRIO DE VENDAS
      ===================================================== */

      const reportsMatch = url.pathname.match(
        /^\/api\/stores\/([^/]+)\/reports\/sales$/,
      );

      if (reportsMatch && request.method === "GET") {
        const sellerId = decodeURIComponent(reportsMatch[1]);

        await getStore(env, sellerId);

        /*
         * As datas vêm da tela.
         *
         * Exemplo:
         *
         * ?from=2026-01-01
         * &to=2026-08-31
         */

        const fromValue = url.searchParams.get("from");

        const toValue = url.searchParams.get("to");

        const from = reportDate(fromValue, false);

        const to = reportDate(toValue, true);

        if (!from || !to) {
          return out(
            {
              error: "Informe from e to no formato YYYY-MM-DD.",
            },
            400,
          );
        }

        if (from > to) {
          return out(
            {
              error: "A data inicial não pode ser maior que a data final.",
            },
            400,
          );
        }

        /*
         * Limite de segurança:
         * relatório máximo de 12 meses.
         */
        const maxFrom = new Date(to);

        maxFrom.setUTCFullYear(maxFrom.getUTCFullYear() - 1);

        if (from < maxFrom) {
          return out(
            {
              error: "O período máximo do relatório é de 12 meses.",
            },
            400,
          );
        }

        const accessToken = await getAccessToken(env, sellerId);

        const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));

        const limit = Math.min(
          50,
          Math.max(1, Number(url.searchParams.get("limit") || 50)),
        );

        const report = await getSalesReport(
          sellerId,
          accessToken,
          from,
          to,
          offset,
          limit,
        );

        return out(report);
      }

      /* =====================================================
         HEALTH
      ===================================================== */

      if (url.pathname === "/api/health" && request.method === "GET") {
        return out({
          ok: true,

          service: "mercado-livre-dashboard-api",

          timestamp: new Date().toISOString(),
        });
      }

      /* =====================================================
         404
      ===================================================== */

      return out(
        {
          error: "Endpoint não encontrado.",
        },
        404,
      );
    } catch (error) {
      console.error(error);

      return out(
        {
          error: error.message || "Erro interno.",
        },
        500,
      );
    }
  },
};
