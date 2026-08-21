const ML =
  "https://api.mercadolibre.com";

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
  "total_sold_quantity_desc"
]);


const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods":
    "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type,Authorization",
  "Content-Type":
    "application/json;charset=utf-8"
};


const out = (
  data,
  status = 200
) => {

  return new Response(
    JSON.stringify(data),
    {
      status,
      headers
    }
  );
};


const reqenv = (
  env,
  key
) => {

  if (!env[key]) {

    throw new Error(
      `Secret ${key} não configurado.`
    );
  }

  return env[key];
};


/* =========================================================
   STORE
========================================================= */

async function getStore(
  env,
  sellerId
) {

  const id =
    String(
      sellerId || ""
    ).trim();

  if (!id) {

    throw new Error(
      "seller_id não informado."
    );
  }


  const key =
    `store:${id}`;


  const saved =
    await env.ML_STORES.get(
      key,
      "json"
    );


  if (saved) {

    return saved;
  }


  /*
   * Migração da loja antiga.
   *
   * Ela já existia usando:
   * ML_SELLER_ID
   * ML_REFRESH_TOKEN
   * ML_STORE_NAME
   * ML_STORE_LOGO_URL
   */

  const configuredSellerId =
    env.ML_SELLER_ID;


  if (
    !configuredSellerId ||
    String(
      configuredSellerId
    ) !== id
  ) {

    throw new Error(
      "Loja não encontrada."
    );
  }


  const refreshToken =
    reqenv(
      env,
      "ML_REFRESH_TOKEN"
    );


  const store = {

    seller_id:
      id,

    name:
      env.ML_STORE_NAME ||
      "Loja Mercado Livre",

    logo_url:
      env.ML_STORE_LOGO_URL ||
      "",

    refresh_token:
      refreshToken,

    access_token:
      null,

    expires_at:
      0,

    active:
      true
  };


  await env.ML_STORES.put(
    key,
    JSON.stringify(store)
  );


  return store;
}


async function saveStore(
  env,
  store
) {

  const key =
    `store:${store.seller_id}`;


  await env.ML_STORES.put(
    key,
    JSON.stringify(store)
  );


  return store;
}


/*
 * Lista todas as lojas armazenadas no KV.
 *
 * Também garante que a loja antiga seja migrada.
 */

async function listStores(
  env
) {

  /*
   * Primeiro garante a migração
   * da loja antiga.
   */
  if (env.ML_SELLER_ID) {

    try {

      await getStore(
        env,
        env.ML_SELLER_ID
      );

    } catch {

      /*
       * Se a migração falhar,
       * continuamos para listar
       * o que já existe no KV.
       */
    }
  }


  const stores = [];

  let cursor;


  do {

    const result =
      await env.ML_STORES.list({

        prefix:
          "store:",

        cursor
      });


    for (
      const key of result.keys
    ) {

      const store =
        await env.ML_STORES.get(
          key.name,
          "json"
        );


      if (
        store &&
        store.seller_id
      ) {

        /*
         * Se ainda não temos a logo,
         * consulta o perfil do vendedor
         * no Mercado Livre.
         */
        if (
          !store.logo_url &&
          store.access_token
        ) {

          try {

            const user =
              await ml(
                `/users/${encodeURIComponent(
                  store.seller_id
                )}`,
                store.access_token
              );


            /*
             * O Mercado Livre pode retornar
             * a logo no campo "logo".
             */
            if (
              user &&
              user.logo
            ) {

              store.logo_url =
                user.logo;


              /*
               * Salva a logo no KV para
               * não precisar consultar
               * novamente nas próximas chamadas.
               */
              await saveStore(
                env,
                store
              );
            }

          } catch (error) {

            /*
             * Falha na consulta da logo
             * não deve impedir que a loja
             * apareça no dashboard.
             */
            console.error(
              `Erro ao buscar logo da loja ${store.seller_id}:`,
              error
            );
          }
        }


        stores.push({

          id:
            store.seller_id,

          seller_id:
            store.seller_id,

          name:
            store.name ||
            "Loja Mercado Livre",

          logo_url:
            store.logo_url ||
            "",

          active:
            store.active !== false
        });
      }
    }


    cursor =
      result.list_complete
        ? undefined
        : result.cursor;

  } while (cursor);


  /*
   * Remove duplicados por seller_id.
   */
  const unique =
    new Map();


  for (
    const store of stores
  ) {

    unique.set(
      String(
        store.seller_id
      ),
      store
    );
  }


  return Array.from(
    unique.values()
  );
}


/* =========================================================
   ACCESS TOKEN
========================================================= */

async function getAccessToken(
  env,
  sellerId
) {

  const store =
    await getStore(
      env,
      sellerId
    );


  const now =
    Date.now();


  /*
   * Reutiliza o access token
   * enquanto ainda estiver válido.
   */

  if (
    store.access_token &&
    store.expires_at &&
    now <
      Number(
        store.expires_at
      ) -
        60000
  ) {

    return store.access_token;
  }


  const form =
    new URLSearchParams({

      grant_type:
        "refresh_token",

      client_id:
        reqenv(
          env,
          "ML_CLIENT_ID"
        ),

      client_secret:
        reqenv(
          env,
          "ML_CLIENT_SECRET"
        ),

      refresh_token:
        store.refresh_token
    });


  const response =
    await fetch(
      `${ML}/oauth/token`,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",

          "Accept":
            "application/json"
        },

        body:
          form
      }
    );


  const data =
    await response
      .json()
      .catch(
        () => ({})
      );


  if (!response.ok) {

    throw new Error(
      `OAuth ${response.status}: ${
        data.message ||
        data.error ||
        "erro ao renovar token"
      }`
    );
  }


  store.access_token =
    data.access_token;


  store.expires_at =
    Date.now() +
    Number(
      data.expires_in ||
      21600
    ) *
      1000;


  /*
   * O Mercado Livre pode
   * fornecer um novo refresh token.
   */

  if (
    data.refresh_token
  ) {

    store.refresh_token =
      data.refresh_token;
  }


  await saveStore(
    env,
    store
  );


  return store.access_token;
}


/* =========================================================
   MERCADO LIVRE API
========================================================= */

async function ml(
  path,
  accessToken,
  extraHeaders = {}
) {

  const response =
    await fetch(
      `${ML}${path}`,
      {
        headers: {

          Authorization:
            `Bearer ${accessToken}`,

          Accept:
            "application/json",

          ...extraHeaders
        }
      }
    );


  const data =
    await response
      .json()
      .catch(
        () => ({})
      );


  if (
    !response.ok &&
    response.status !== 206
  ) {

    throw new Error(
      `Mercado Livre ${response.status}: ${
        data.message ||
        data.error ||
        "erro"
      }`
    );
  }


  return data;
}


/* =========================================================
   SHIPMENTS
========================================================= */

async function getShipment(
  shipmentId,
  accessToken
) {

  if (!shipmentId) {

    return null;
  }


  try {

    return await ml(
      `/shipments/${encodeURIComponent(
        shipmentId
      )}`,
      accessToken,
      {
        "x-format-new":
          "true"
      }
    );

  } catch {

    return null;
  }
}


function classifyShipping(
  shipment
) {

  if (!shipment) {

    return "no_shipping";
  }


  const status =
    shipment.status;


  const substatus =
    shipment.substatus;


  if (
    status ===
    "cancelled"
  ) {

    return "cancelled";
  }


  if (
    status ===
    "delivered"
  ) {

    return "delivered";
  }


  if (
    status ===
      "shipped" ||
    status ===
      "in_transit" ||
    status ===
      "out_for_delivery"
  ) {

    return "shipped";
  }


  if (
    status ===
      "ready_to_ship" ||
    status ===
      "handling" ||
    status ===
      "pending"
  ) {

    return "pending_shipping";
  }


  if (
    [
      "picked_up",
      "authorized_by_carrier",
      "in_hub"
    ].includes(
      substatus
    )
  ) {

    return "shipped";
  }


  return "other";
}


/* =========================================================
   DATAS
========================================================= */

function localDateKey(
  date
) {

  const d =
    new Date(date);


  if (
    Number.isNaN(
      d.getTime()
    )
  ) {

    return null;
  }


  const year =
    d.getFullYear();


  const month =
    String(
      d.getMonth() + 1
    ).padStart(
      2,
      "0"
    );


  const day =
    String(
      d.getDate()
    ).padStart(
      2,
      "0"
    );


  return `${year}-${month}-${day}`;
}


function lastSevenDays() {

  const result = [];

  const now =
    new Date();


  for (
    let i = 6;
    i >= 0;
    i--
  ) {

    const date =
      new Date(now);


    date.setHours(
      0,
      0,
      0,
      0
    );


    date.setDate(
      date.getDate() -
        i
    );


    result.push({

      date:
        localDateKey(
          date
        ),

      sales:
        0,

      revenue:
        0,

      cancelled:
        0
    });
  }


  return result;
}


function orderRevenue(
  order
) {

  const value =
    Number(
      order.total_amount
    );


  if (
    Number.isFinite(
      value
    )
  ) {

    return value;
  }


  return (
    order.order_items ||
    []
  ).reduce(
    (
      total,
      item
    ) => {

      return (
        total +
        Number(
          item.unit_price ||
          0
        ) *
        Number(
          item.quantity ||
          0
        )
      );

    },
    0
  );
}


/* =========================================================
   PEDIDOS
========================================================= */

async function getOrdersSummary(
  sellerId,
  accessToken
) {

  const days =
    lastSevenDays();


  const from =
    new Date();


  from.setHours(
    0,
    0,
    0,
    0
  );


  from.setDate(
    from.getDate() -
      6
  );


  const to =
    new Date();


  const allOrders = [];

  let offset =
    0;

  const limit =
    50;

  let total =
    null;


  /*
   * Busca todas as páginas
   * de pedidos.
   */

  do {

    const searchParams =
      new URLSearchParams({

        seller:
          sellerId,

        "order.date_created.from":
          from.toISOString(),

        "order.date_created.to":
          to.toISOString(),

        sort:
          "date_desc",

        limit:
          String(
            limit
          ),

        offset:
          String(
            offset
          )
      });


    const search =
      await ml(
        `/orders/search?${searchParams.toString()}`,
        accessToken
      );


    const orders =
      search.results ||
      [];


    allOrders.push(
      ...orders
    );


    total =
      Number(
        search.paging?.total ||
        allOrders.length
      );


    offset +=
      orders.length;


    if (
      orders.length ===
      0
    ) {

      break;
    }


    if (
      offset >=
      total
    ) {

      break;
    }

  } while (
    offset <
    total
  );


  const summary = {

    sales:
      0,

    revenue:
      0,

    cancelled:
      0,

    pending_shipping:
      0,

    shipped:
      0,

    delivered:
      0,

    other:
      0
  };


  /*
   * Busca shipments em lotes.
   */

  const enrichedOrders =
    [];


  for (
    let i = 0;
    i <
      allOrders.length;
    i += 5
  ) {

    const batch =
      allOrders.slice(
        i,
        i + 5
      );


    const enriched =
      await Promise.all(
        batch.map(
          async order => {

            const shipmentId =
              order.shipping?.id;


            const shipment =
              shipmentId
                ? await getShipment(
                    shipmentId,
                    accessToken
                  )
                : null;


            const shippingStatus =
              classifyShipping(
                shipment
              );


            return {
              order,
              shipment,
              shippingStatus
            };
          }
        )
      );


    enrichedOrders.push(
      ...enriched
    );
  }


  /*
   * Processa os pedidos.
   */

  for (
    const entry of
      enrichedOrders
  ) {

    const order =
      entry.order;


    const shippingStatus =
      entry.shippingStatus;


    const paymentApproved =
      (
        order.payments ||
        []
      ).some(
        payment =>
          payment.status ===
          "approved"
      );


    const isPaid =
      order.status ===
        "paid" ||
      order.status ===
        "partially_paid" ||
      paymentApproved;


    if (isPaid) {

      summary.sales +=
        1;

      summary.revenue +=
        orderRevenue(
          order
        );
    }


    /*
     * Cancelamentos.
     */

    if (
      order.status ===
        "cancelled" ||
      order.status ===
        "pending_cancel"
    ) {

      summary.cancelled +=
        1;
    }


    /*
     * Situação do envio.
     */

    if (
      shippingStatus ===
      "pending_shipping"
    ) {

      summary.pending_shipping +=
        1;

    } else if (
      shippingStatus ===
      "shipped"
    ) {

      summary.shipped +=
        1;

    } else if (
      shippingStatus ===
      "delivered"
    ) {

      summary.delivered +=
        1;

    } else if (
      shippingStatus ===
      "other"
    ) {

      summary.other +=
        1;
    }


    /*
     * Gráfico.
     */

    const date =
      localDateKey(
        order.date_closed ||
        order.date_created
      );


    const day =
      days.find(
        item =>
          item.date ===
          date
      );


    if (day) {

      if (isPaid) {

        day.sales +=
          1;

        day.revenue +=
          orderRevenue(
            order
          );
      }


      if (
        order.status ===
          "cancelled" ||
        order.status ===
          "pending_cancel"
      ) {

        day.cancelled +=
          1;
      }
    }
  }


  summary.revenue =
    Number(
      summary.revenue.toFixed(
        2
      )
    );


  days.forEach(
    day => {

      day.revenue =
        Number(
          day.revenue.toFixed(
            2
          )
        );
    }
  );


  return {

    seller_id:
      sellerId,

    period: {

      days:
        7,

      from:
        from.toISOString(),

      to:
        to.toISOString()
    },

    summary,

    daily:
      days,

    orders_found:
      allOrders.length,

    paging: {

      total,

      offset:
        0,

      limit
    }
  };
}


/* =========================================================
   OAUTH START
========================================================= */

async function oauthStart(
  env
) {

  const clientId =
    reqenv(
      env,
      "ML_CLIENT_ID"
    );


  /*
   * Mantemos state para
   * proteger o fluxo OAuth.
   */

  const state =
    crypto.randomUUID();


  await env.ML_STORES.put(
    `oauth:state:${state}`,
    JSON.stringify({
      created_at:
        Date.now()
    }),
    {
      expirationTtl:
        600
    }
  );


  const authUrl =
    new URL(
      "https://auth.mercadolivre.com.br/authorization"
    );


  authUrl.searchParams.set(
    "response_type",
    "code"
  );


  authUrl.searchParams.set(
    "client_id",
    clientId
  );


  authUrl.searchParams.set(
    "redirect_uri",
    ML_REDIRECT_URI
  );


  authUrl.searchParams.set(
    "state",
    state
  );


  return Response.redirect(
    authUrl.toString(),
    302
  );
}


/* =========================================================
   OAUTH CALLBACK
========================================================= */

async function oauthCallback(
  request,
  env
) {

  const url =
    new URL(
      request.url
    );


  const code =
    url.searchParams.get(
      "code"
    );


  const state =
    url.searchParams.get(
      "state"
    );


  const oauthError =
    url.searchParams.get(
      "error"
    );


  if (
    oauthError
  ) {

    return Response.redirect(
      `${FRONTEND_URL}?oauth_error=${encodeURIComponent(
        oauthError
      )}`,
      302
    );
  }


  if (!code) {

    return Response.redirect(
      `${FRONTEND_URL}?oauth_error=no_code`,
      302
    );
  }


  /*
   * O state é recomendado.
   *
   * Se o Mercado Livre não retornar
   * o state, não continuamos o fluxo.
   */

  if (!state) {

    return Response.redirect(
      `${FRONTEND_URL}?oauth_error=no_state`,
      302
    );
  }


  const stateKey =
    `oauth:state:${state}`;


  const savedState =
    await env.ML_STORES.get(
      stateKey
    );


  if (!savedState) {

    return Response.redirect(
      `${FRONTEND_URL}?oauth_error=invalid_state`,
      302
    );
  }


  /*
   * State de uso único.
   */

  await env.ML_STORES.delete(
    stateKey
  );


  /*
   * Troca authorization code
   * por access/refresh token.
   */

  const form =
    new URLSearchParams({

      grant_type:
        "authorization_code",

      client_id:
        reqenv(
          env,
          "ML_CLIENT_ID"
        ),

      client_secret:
        reqenv(
          env,
          "ML_CLIENT_SECRET"
        ),

      code,

      redirect_uri:
        ML_REDIRECT_URI
    });


  const response =
    await fetch(
      `${ML}/oauth/token`,
      {
        method:
          "POST",

        headers: {

          "Accept":
            "application/json",

          "Content-Type":
            "application/x-www-form-urlencoded"
        },

        body:
          form
      }
    );


  const token =
    await response
      .json()
      .catch(
        () => ({})
      );


  if (!response.ok) {

    return Response.redirect(
      `${FRONTEND_URL}?oauth_error=${encodeURIComponent(
        token.message ||
        token.error ||
        `oauth_${response.status}`
      )}`,
      302
    );
  }


  /*
   * user_id retornado pelo OAuth
   * é o seller_id da loja.
   */

  const sellerId =
    String(
      token.user_id ||
      ""
    ).trim();


  if (!sellerId) {

    return Response.redirect(
      `${FRONTEND_URL}?oauth_error=no_user_id`,
      302
    );
  }


  /*
   * Busca os dados públicos
   * da conta para obter o nome.
   */

  let user = {};


  try {

    user =
      await ml(
        `/users/${encodeURIComponent(
          sellerId
        )}`,
        token.access_token
      );

  } catch {

    user = {};
  }


  const existing =
    await env.ML_STORES.get(
      `store:${sellerId}`,
      "json"
    );


  const store = {

    seller_id:
      sellerId,

    name:
      user.nickname ||
      user.first_name ||
      existing?.name ||
      `Loja ${sellerId}`,

    logo_url:
    user.logo ||
    existing?.logo_url ||
    "",

    refresh_token:
      token.refresh_token ||
      existing?.refresh_token ||
      "",

    access_token:
      token.access_token ||
      null,

    expires_at:
      Date.now() +
      Number(
        token.expires_in ||
        21600
      ) *
        1000,

    active:
      true
  };


  if (
    !store.refresh_token
  ) {

    return Response.redirect(
      `${FRONTEND_URL}?oauth_error=no_refresh_token`,
      302
    );
  }


  await saveStore(
    env,
    store
  );


  /*
   * Retorna ao GitHub Pages.
   */

  return Response.redirect(
    `${FRONTEND_URL}?oauth=success`,
    302
  );
}


/* =========================================================
   CREATE STORE
========================================================= */

async function createStore(
  env,
  data
) {

  const sellerId =
    String(
      data.seller_id ||
      ""
    ).trim();


  const name =
    String(
      data.name ||
      ""
    ).trim();


  const logoUrl =
    String(
      data.logo_url ||
      ""
    ).trim();


  const refreshToken =
    String(
      data.refresh_token ||
      ""
    ).trim();


  if (!sellerId) {

    throw new Error(
      "seller_id é obrigatório."
    );
  }


  if (!name) {

    throw new Error(
      "name é obrigatório."
    );
  }


  if (!refreshToken) {

    throw new Error(
      "refresh_token é obrigatório."
    );
  }


  const key =
    `store:${sellerId}`;


  const existing =
    await env.ML_STORES.get(
      key,
      "json"
    );


  if (existing) {

    throw new Error(
      "Esta loja já está cadastrada."
    );
  }


  /*
   * Valida o refresh token
   * antes de salvar.
   */

  const form =
    new URLSearchParams({

      grant_type:
        "refresh_token",

      client_id:
        reqenv(
          env,
          "ML_CLIENT_ID"
        ),

      client_secret:
        reqenv(
          env,
          "ML_CLIENT_SECRET"
        ),

      refresh_token:
        refreshToken
    });


  const response =
    await fetch(
      `${ML}/oauth/token`,
      {
        method:
          "POST",

        headers: {

          "Content-Type":
            "application/x-www-form-urlencoded"
        },

        body:
          form
      }
    );


  const oauth =
    await response
      .json()
      .catch(
        () => ({})
      );


  if (!response.ok) {

    throw new Error(
      `Não foi possível conectar a loja: ${
        oauth.message ||
        oauth.error ||
        `OAuth ${response.status}`
      }`
    );
  }


  const store = {

    seller_id:
      sellerId,

    name,

    logo_url:
      logoUrl,

    refresh_token:
      oauth.refresh_token ||
      refreshToken,

    access_token:
      oauth.access_token ||
      null,

    expires_at:
      Date.now() +
      Number(
        oauth.expires_in ||
        21600
      ) *
        1000,

    active:
      true
  };


  await env.ML_STORES.put(
    key,
    JSON.stringify(store)
  );


  return store;
}


/* =========================================================
   WORKER
========================================================= */

export default {

  async fetch(
    request,
    env
  ) {

    if (
      request.method ===
      "OPTIONS"
    ) {

      return new Response(
        null,
        {
          status:
            204,

          headers
        }
      );
    }


    try {

      const url =
        new URL(
          request.url
        );


      /* =====================================================
         OAUTH START
      ===================================================== */

      if (
        url.pathname ===
          "/api/oauth/start" &&
        request.method ===
          "GET"
      ) {

        return oauthStart(
          env
        );
      }


      /* =====================================================
         OAUTH CALLBACK
      ===================================================== */

      if (
        url.pathname ===
          "/api/oauth/callback" &&
        request.method ===
          "GET"
      ) {

        return oauthCallback(
          request,
          env
        );
      }


      /* =====================================================
         LISTA DE LOJAS
      ===================================================== */

      if (
        url.pathname ===
          "/api/stores" &&
        request.method ===
          "GET"
      ) {

        const stores =
          await listStores(
            env
          );


        return out({
          stores
        });
      }


      /* =====================================================
         CADASTRO MANUAL
         
         Mantido apenas por compatibilidade.
         O frontend não deve mais usar essa rota
         para adicionar lojas.
      ===================================================== */

      if (
        url.pathname ===
          "/api/stores" &&
        request.method ===
          "POST"
      ) {

        try {

          const data =
            await request.json();


          const store =
            await createStore(
              env,
              data
            );


          return out(
            {
              success:
                true,

              store
            },
            201
          );

        } catch (
          error
        ) {

          return out(
            {
              error:
                error.message ||
                "Erro ao cadastrar loja."
            },
            400
          );
        }
      }


      /* =====================================================
         ANÚNCIOS
      ===================================================== */

      const itemsMatch =
        url.pathname.match(
          /^\/api\/stores\/([^/]+)\/items$/
        );


      if (
        itemsMatch &&
        request.method ===
          "GET"
      ) {

        const sellerId =
          decodeURIComponent(
            itemsMatch[1]
          );


        /*
         * Confirma que a loja existe.
         */

        await getStore(
          env,
          sellerId
        );


        const order =
          url.searchParams.get(
            "order"
          ) ||
          "sold_quantity_desc";


        if (
          !ORDERS.has(
            order
          )
        ) {

          return out(
            {
              error:
                "Ordenação inválida."
            },
            400
          );
        }


        const offset =
          Math.max(
            0,
            Number(
              url.searchParams.get(
                "offset"
              ) ||
                0
            )
          );


        const limit =
          Math.min(
            50,
            Math.max(
              1,
              Number(
                url.searchParams.get(
                  "limit"
                ) ||
                  24
              )
            )
          );


        const accessToken =
          await getAccessToken(
            env,
            sellerId
          );


        const params =
          new URLSearchParams({

            orders:
              order,

            offset:
              String(
                offset
              ),

            limit:
              String(
                limit
              )
          });


        const search =
          await ml(
            `/users/${encodeURIComponent(
              sellerId
            )}/items/search?${params.toString()}`,
            accessToken
          );


        const ids =
          search.results ||
          [];


        const items =
          [];


        /*
         * Busca detalhes dos anúncios
         * em lotes de 5.
         */

        for (
          let i = 0;
          i <
            ids.length;
          i += 5
        ) {

          const batch =
            ids.slice(
              i,
              i + 5
            );


          const batchItems =
            await Promise.all(
              batch.map(
                itemId =>
                  ml(
                    `/items/${encodeURIComponent(
                      itemId
                    )}`,
                    accessToken
                  )
              )
            );


          items.push(
            ...batchItems
          );
        }


        return out({

          seller_id:
            sellerId,

          items,

          paging:
            search.paging ||
            {
              limit,

              offset,

              total:
                items.length
            },

          orders:
            search.orders ||
            [],

          available_orders:
            search.available_orders ||
            []
        });
      }


      /* =====================================================
         VENDAS / PEDIDOS
      ===================================================== */

      const ordersMatch =
        url.pathname.match(
          /^\/api\/stores\/([^/]+)\/orders$/
        );


      if (
        ordersMatch &&
        request.method ===
          "GET"
      ) {

        const sellerId =
          decodeURIComponent(
            ordersMatch[1]
          );


        await getStore(
          env,
          sellerId
        );


        const accessToken =
          await getAccessToken(
            env,
            sellerId
          );


        const summary =
          await getOrdersSummary(
            sellerId,
            accessToken
          );


        return out(
          summary
        );
      }


      /* =====================================================
         HEALTH
      ===================================================== */

      if (
        url.pathname ===
          "/api/health" &&
        request.method ===
          "GET"
      ) {

        return out({

          ok:
            true,

          service:
            "mercado-livre-dashboard-api",

          timestamp:
            new Date()
              .toISOString()
        });
      }


      /* =====================================================
         404
      ===================================================== */

      return out(
        {
          error:
            "Endpoint não encontrado."
        },
        404
      );


    } catch (
      error
    ) {

      console.error(
        error
      );


      return out(
        {
          error:
            error.message ||
            "Erro interno."
        },
        500
      );
    }
  }
};