const $ = s => document.querySelector(s);

const API_BASE =
  "https://mercado-livre-dashboard-api.mercado-livre-marcelo.workers.dev";

const state = {
  store: null,
  page: 1,
  limit: 24,
  total: 0,
  order: "sold_quantity_desc",
  items: []
};

const esc = v =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const money = v =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(v || 0));

const num = v =>
  new Intl.NumberFormat("pt-BR").format(Number(v || 0));

const dt = v => {
  if (!v) return "-";

  const d = new Date(v);

  return Number.isNaN(d.getTime())
    ? String(v)
    : new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short"
      }).format(d);
};

const screen = id => {
  document
    .querySelectorAll(".screen")
    .forEach(x => x.classList.remove("active"));

  $(id).classList.add("active");

  scrollTo(0, 0);
};

const toast = m => {
  const element = $("#toast");

  if (!element) return;

  element.textContent = m;
  element.classList.add("show");

  setTimeout(
    () => element.classList.remove("show"),
    3000
  );
};

/* =========================================================
   API
========================================================= */

const API = {
  async request(path, options = {}) {
    const response = await fetch(
      `${API_BASE}${path}`,
      options
    );

    const data = await response
      .json()
      .catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error ||
        `Erro HTTP ${response.status}`
      );
    }

    return data;
  },

  async stores() {
    return this.request("/api/stores");
  },

  async addStore(data) {
    return this.request("/api/stores", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    });
  },

  async items(
    sellerId,
    offset,
    limit,
    order
  ) {
    const params = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
      order
    });

    return this.request(
      `/api/stores/${encodeURIComponent(
        sellerId
      )}/items?${params.toString()}`
    );
  },

  async orders(sellerId) {
    return this.request(
      `/api/stores/${encodeURIComponent(
        sellerId
      )}/orders`
    );
  }
};

/* =========================================================
   ADICIONAR LOJA
========================================================= */

function addStore() {
  window.location.href =
    `${API_BASE}/api/oauth/start`;
}

  if (!name || !name.trim()) {
    return;
  }

  const sellerId = prompt(
    "Seller ID do Mercado Livre:"
  );

  if (!sellerId || !sellerId.trim()) {
    return;
  }

  const refreshToken = prompt(
    "Refresh Token do Mercado Livre:"
  );

  if (
    !refreshToken ||
    !refreshToken.trim()
  ) {
    return;
  }

  try {
    toast("Conectando loja...");

    const result = await API.addStore({
      name: name.trim(),
      seller_id: sellerId.trim(),
      refresh_token: refreshToken.trim(),
      logo_url: ""
    });

    if (!result.success) {
      throw new Error(
        result.error ||
        "Não foi possível cadastrar a loja."
      );
    }

    toast(
      "Loja cadastrada com sucesso."
    );

    await loadStores();

  } catch (error) {
    toast(
      error.message ||
      "Erro ao cadastrar loja."
    );
  }
}

/* =========================================================
   LOJAS
========================================================= */

async function loadStores() {
  const g = $("#storesGrid");

  g.innerHTML =
    '<div class="loading">Carregando lojas...</div>';

  try {
    const d = await API.stores();

    const stores = d.stores || [];

    if (stores.length) {
      g.innerHTML = stores
        .map(
          x => `
            <article
              class="store"
              data-id="${esc(x.seller_id)}"
            >
              <div class="logo">
                ${
                  x.logo_url
                    ? `<img
                         src="${esc(x.logo_url)}"
                         alt=""
                       >`
                    : "ML"
                }
              </div>

              <div>
                <small>LOJA</small>

                <h3>
                  ${esc(x.name)}
                </h3>

                <span>
                  Seller ID:
                  ${esc(x.seller_id)}
                </span>
              </div>

              <strong>→</strong>
            </article>
          `
        )
        .join("");
    } else {
      g.innerHTML =
        '<div class="empty">Nenhuma loja cadastrada.</div>';
    }

    /*
     * Botão adicionar loja
     */
    const addButton =
      document.createElement("button");

    addButton.type = "button";
    addButton.className =
      "add-store-button";

    addButton.textContent =
      "+ Adicionar loja";

    addButton.onclick = addStore;

    g.prepend(addButton);

    /*
     * Clique nas lojas
     */
    g.querySelectorAll(".store")
      .forEach(card => {
        card.onclick = () => {
          const store = stores.find(
            x =>
              String(x.seller_id) ===
              card.dataset.id
          );

          if (store) {
            openStore(store);
          }
        };
      });

  } catch (e) {
    g.innerHTML = `
      <div class="empty">
        <h3>
          Erro ao carregar lojas
        </h3>

        <p>
          ${esc(e.message)}
        </p>
      </div>
    `;
  }
}

/* =========================================================
   ABRIR LOJA
========================================================= */

async function openStore(s) {
  state.store = s;
  state.page = 1;
  state.order =
    "sold_quantity_desc";

  $("#storeName").textContent =
    s.name;

  $("#seller").textContent =
    `Seller ID: ${s.seller_id}`;

  $("#logo").innerHTML =
    s.logo_url
      ? `<img
           src="${esc(s.logo_url)}"
           alt=""
         >`
      : "ML";

  $("#order").value =
    state.order;

  screen("#items");

  await Promise.all([
    loadSales(),
    loadItems()
  ]);
}

/* =========================================================
   CARDS DO RESUMO
========================================================= */

function renderSummaryCards(x) {
  $("#summaryCards").innerHTML = `
    <div class="stat-card">
      <span class="stat-icon sales">
        V
      </span>

      <div>
        <small>VENDAS</small>

        <strong>
          ${num(x.sales)}
        </strong>

        <em>
          últimos 7 dias
        </em>
      </div>
    </div>

    <div class="stat-card">
      <span class="stat-icon revenue">
        R$
      </span>

      <div>
        <small>FATURAMENTO</small>

        <strong>
          ${money(x.revenue)}
        </strong>

        <em>
          últimos 7 dias
        </em>
      </div>
    </div>

    <div class="stat-card">
      <span class="stat-icon cancel">
        !
      </span>

      <div>
        <small>CANCELADOS</small>

        <strong>
          ${num(x.cancelled)}
        </strong>

        <em>
          pedidos
        </em>
      </div>
    </div>

    <div class="stat-card">
      <span class="stat-icon pending">
        ↗
      </span>

      <div>
        <small>PENDENTES DE ENVIO</small>

        <strong>
          ${num(x.pending_shipping)}
        </strong>

        <em>
          pedidos
        </em>
      </div>
    </div>
  `;
}

/* =========================================================
   GRÁFICO
========================================================= */

function dayLabel(s) {
  return new Intl.DateTimeFormat(
    "pt-BR",
    {
      day: "2-digit",
      month: "2-digit"
    }
  ).format(
    new Date(`${s}T12:00:00`)
  );
}

function renderCombinedChart(
  days,
  summary
) {
  const container =
    $("#combinedChart");

  if (!days.length) {
    container.innerHTML =
      '<div class="chart-empty">Dados indisponíveis.</div>';

    return;
  }

  const W = 1000;
  const H = 390;
  const L = 58;
  const R = 72;
  const T = 30;
  const B = 55;

  const pw = W - L - R;
  const ph = H - T - B;

  const salesMax = Math.max(
    ...days.map(
      x => Number(x.sales || 0)
    ),
    1
  );

  const cancelMax = Math.max(
    ...days.map(
      x => Number(x.cancelled || 0)
    ),
    1,
    5
  );

  const revenueMax = Math.max(
    ...days.map(
      x => Number(x.revenue || 0)
    ),
    1
  );

  const x = i =>
    L +
    (
      days.length === 1
        ? pw / 2
        : (i / (days.length - 1)) * pw
    );

  const ySales = v =>
    T +
    ph -
    (Number(v || 0) /
      salesMax) *
      ph;

  const yCancel = v =>
    T +
    ph -
    (Number(v || 0) /
      cancelMax) *
      ph;

  const yRevenue = v =>
    T +
    ph -
    (Number(v || 0) /
      revenueMax) *
      ph;

  const path = (key, y) =>
    days
      .map(
        (d, i) =>
          `${i ? "L" : "M"} ${x(i).toFixed(
            1
          )} ${y(d[key]).toFixed(1)}`
      )
      .join(" ");

  const salesPath =
    path("sales", ySales);

  const revenuePath =
    path("revenue", yRevenue);

  const cancelPath =
    path("cancelled", yCancel);

  const grid = Array.from(
    { length: 5 },
    (_, i) => {
      const ratio = i / 4;

      const yy =
        T +
        ph -
        ratio * ph;

      const salesVal =
        Math.round(
          salesMax * ratio
        );

      const revVal =
        revenueMax * ratio;

      return `
        <line
          x1="${L}"
          y1="${yy}"
          x2="${W - R}"
          y2="${yy}"
          class="chart-grid"
        />

        <text
          x="${L - 10}"
          y="${yy + 4}"
          text-anchor="end"
          class="axis-sales"
        >
          ${num(salesVal)}
        </text>

        <text
          x="${W - R + 10}"
          y="${yy + 4}"
          class="axis-revenue"
        >
          ${money(revVal)}
        </text>
      `;
    }
  ).join("");

  const labels = days
    .map((d, i) => {
      const xx = x(i);

      return `
        <text
          x="${xx}"
          y="${H - 22}"
          text-anchor="middle"
          class="x-label"
        >
          ${dayLabel(d.date)}
        </text>
      `;
    })
    .join("");

  const points = days
    .map((d, i) => {
      const xx = x(i);

      return `
        <g
          class="point-group"
          data-index="${i}"
        >
          <circle
            cx="${xx}"
            cy="${ySales(d.sales)}"
            r="5"
            class="point sales-point"
          />

          <circle
            cx="${xx}"
            cy="${yRevenue(d.revenue)}"
            r="5"
            class="point revenue-point"
          />

          <circle
            cx="${xx}"
            cy="${yCancel(d.cancelled)}"
            r="5"
            class="point cancel-point"
          />

          <rect
            x="${xx - 18}"
            y="${T}"
            width="36"
            height="${ph}"
            class="hover-zone"
          />
        </g>
      `;
    })
    .join("");

  container.innerHTML = `
    <div class="line-chart-wrap">

      <svg
        viewBox="0 0 ${W} ${H}"
        preserveAspectRatio="none"
        class="chart-svg"
        aria-label="Vendas, faturamento e cancelamentos dos últimos 7 dias"
      >
        ${grid}

        <line
          x1="${L}"
          y1="${T + ph}"
          x2="${W - R}"
          y2="${T + ph}"
          class="chart-axis"
        />

        <path
          d="${salesPath}"
          class="line sales-line"
        />

        <path
          d="${revenuePath}"
          class="line revenue-line"
        />

        <path
          d="${cancelPath}"
          class="line cancel-line"
        />

        ${points}
        ${labels}

      </svg>

      <div
        id="chartTooltip"
        class="chart-tooltip"
      ></div>

    </div>
  `;

  $("#chartSalesTotal").textContent =
    `${num(summary.sales)} vendas`;

  $("#chartRevenueTotal").textContent =
    money(summary.revenue);

  $("#chartCancelledTotal").textContent =
    `${num(summary.cancelled)} cancelamentos`;

  const tooltip =
    $("#chartTooltip");

  container
    .querySelectorAll(".point-group")
    .forEach(group => {

      group.addEventListener(
        "mouseenter",
        () => {
          const i =
            Number(
              group.dataset.index
            );

          const d = days[i];

          tooltip.innerHTML = `
            <strong>
              ${dayLabel(d.date)}
            </strong>

            <span class="tt-sales">
              <i></i>
              Vendas:
              <b>${num(d.sales)}</b>
            </span>

            <span class="tt-revenue">
              <i></i>
              Faturamento:
              <b>${money(d.revenue)}</b>
            </span>

            <span class="tt-cancel">
              <i></i>
              Cancelamentos:
              <b>${num(d.cancelled)}</b>
            </span>
          `;

          tooltip.classList.add(
            "visible"
          );

          const px =
            (i /
              (days.length - 1 || 1)) *
            100;

          tooltip.style.left =
            `${Math.min(
              82,
              Math.max(8, px)
            )}%`;
        }
      );

      group.addEventListener(
        "mouseleave",
        () =>
          tooltip.classList.remove(
            "visible"
          )
      );
    });
}

/* =========================================================
   STATUS
========================================================= */

function renderStatus(x) {
  const a = [
    [
      "Pendentes",
      x.pending_shipping,
      "pending"
    ],
    [
      "Enviados",
      x.shipped,
      "shipped"
    ],
    [
      "Entregues",
      x.delivered,
      "delivered"
    ],
    [
      "Cancelados",
      x.cancelled,
      "cancelled"
    ]
  ];

  const max = Math.max(
    ...a.map(
      v => Number(v[1] || 0)
    ),
    1
  );

  $("#statusBars").innerHTML =
    a
      .map(
        v => `
          <div class="status-row">

            <div class="status-label">
              <span
                class="status-dot ${v[2]}"
              ></span>

              <span>
                ${v[0]}
              </span>

              <strong>
                ${num(v[1])}
              </strong>
            </div>

            <div class="status-track">
              <div
                class="status-fill ${v[2]}"
                style="width:${Math.max(
                  2,
                  Number(v[1] || 0) /
                    max *
                    100
                )}%"
              ></div>
            </div>

          </div>
        `
      )
      .join("");
}

/* =========================================================
   VENDAS
========================================================= */

async function loadSales() {
  try {
    const d =
      await API.orders(
        state.store.seller_id
      );

    renderSummaryCards(
      d.summary || {}
    );

    renderCombinedChart(
      (d.daily || []).map(x => ({
        ...x,
        cancelled:
          Number(x.cancelled || 0)
      })),
      d.summary || {}
    );

    renderStatus(
      d.summary || {}
    );

    const f =
      d.period?.from
        ? new Date(
            d.period.from
          ).toLocaleDateString(
            "pt-BR"
          )
        : "";

    const t =
      d.period?.to
        ? new Date(
            d.period.to
          ).toLocaleDateString(
            "pt-BR"
          )
        : "";

    $("#salesPeriod").textContent =
      f && t
        ? `${f} até ${t}`
        : "";

  } catch (e) {

    $("#summaryCards").innerHTML = `
      <div class="sales-error">
        <strong>
          Não foi possível carregar o resumo de vendas.
        </strong>

        <span>
          ${esc(e.message)}
        </span>
      </div>
    `;

    if (
      $("#combinedChart")
    ) {
      $("#combinedChart").innerHTML =
        '<div class="chart-empty">Dados indisponíveis.</div>';
    }
  }
}

/* =========================================================
   ANÚNCIOS
========================================================= */

async function loadItems() {
  const g = $("#grid");

  $("#loading").style.display =
    "block";

  g.innerHTML = "";
  $("#pages").innerHTML = "";

  try {
    const d =
      await API.items(
        state.store.seller_id,
        (state.page - 1) *
          state.limit,
        state.limit,
        state.order
      );

    state.items =
      d.items || [];

    state.total =
      Number(
        d.paging?.total || 0
      );

    renderItems();
    renderPages();

    const a =
      state.total
        ? (state.page - 1) *
            state.limit +
          1
        : 0;

    const b = Math.min(
      state.page *
        state.limit,
      state.total
    );

    $("#summary").textContent =
      `${num(a)}–${num(b)} de ${num(
        state.total
      )} anúncios`;

  } catch (e) {

    g.innerHTML = `
      <div class="empty">

        <h3>
          Erro ao carregar anúncios
        </h3>

        <p>
          ${esc(e.message)}
        </p>

      </div>
    `;

  } finally {

    $("#loading").style.display =
      "none";
  }
}

function imgs(x) {
  return (x.pictures || [])
    .map(
      p =>
        p.secure_url ||
        p.url
    )
    .filter(Boolean);
}

function sku(x) {
  return (
    x.attributes || []
  ).find(
    a =>
      a.id ===
      "SELLER_SKU"
  )?.value_name || "-";
}

function renderItems() {
  const g = $("#grid");

  if (!state.items.length) {
    g.innerHTML =
      '<div class="empty">Nenhum anúncio encontrado.</div>';

    return;
  }

  g.innerHTML =
    state.items
      .map((x, i) => {
        const a = imgs(x);

        const src =
          x.thumbnail ||
          a[0] ||
          "";

        return `
          <article class="card">

            <div
              class="photo"
              data-index="${i}"
            >

              ${
                src
                  ? `<img
                       src="${esc(src)}"
                       alt="${esc(x.title)}"
                       loading="lazy"
                     >`
                  : "<span>Sem imagem</span>"
              }

              ${
                a.length > 1
                  ? `
                    <button class="prev">
                      ‹
                    </button>

                    <button class="next">
                      ›
                    </button>

                    <em>
                      1 / ${a.length}
                    </em>
                  `
                  : ""
              }

            </div>

            <div class="body">

              <div class="id">
                ${esc(x.id)}

                <label>
                  ${esc(
                    x.condition ||
                    "-"
                  )}
                </label>
              </div>

              <h3>
                ${esc(x.title)}
              </h3>

              <div class="price">
                ${money(x.price)}
              </div>

              <div class="metrics">

                <span>
                  Inicial
                  <strong>
                    ${num(
                      x.initial_quantity
                    )}
                  </strong>
                </span>

                <span>
                  Vendidos
                  <strong>
                    ${num(
                      x.sold_quantity
                    )}
                  </strong>
                </span>

                <span>
                  Estoque
                  <strong>
                    ${num(
                      x.available_quantity
                    )}
                  </strong>
                </span>

                <span>
                  SKU
                  <strong>
                    ${esc(sku(x))}
                  </strong>
                </span>

              </div>

              <div class="dates">
                Criado:
                ${esc(
                  dt(x.date_created)
                )}

                <br>

                Atualizado:
                ${esc(
                  dt(x.last_updated)
                )}
              </div>

              ${
                x.permalink
                  ? `
                    <a
                      href="${esc(
                        x.permalink
                      )}"
                      target="_blank"
                      rel="noopener"
                    >
                      Ver anúncio ↗
                    </a>
                  `
                  : ""
              }

            </div>

          </article>
        `;
      })
      .join("");

  g.querySelectorAll(
    ".photo"
  ).forEach(p => {

    const a =
      imgs(
        state.items[
          +p.dataset.index
        ]
      );

    if (a.length < 2) {
      return;
    }

    let n = 0;

    const img =
      p.querySelector(
        "img"
      );

    const em =
      p.querySelector(
        "em"
      );

    const update = () => {
      img.src = a[n];

      em.textContent =
        `${n + 1} / ${a.length}`;
    };

    p.querySelector(
      ".prev"
    ).onclick = () => {
      n =
        (n - 1 + a.length) %
        a.length;

      update();
    };

    p.querySelector(
      ".next"
    ).onclick = () => {
      n =
        (n + 1) %
        a.length;

      update();
    };
  });
}

/* =========================================================
   PAGINAÇÃO
========================================================= */

function renderPages() {
  const p = $("#pages");

  const totalPages =
    Math.ceil(
      state.total /
        state.limit
    );

  if (totalPages < 2) {
    return;
  }

  const button = (
    label,
    page,
    active = false,
    disabled = false
  ) =>
    `
      <button
        data-page="${page}"
        class="${active ? "active" : ""}"
        ${disabled ? "disabled" : ""}
      >
        ${label}
      </button>
    `;

  let start =
    Math.max(
      1,
      state.page - 2
    );

  let end =
    Math.min(
      totalPages,
      start + 4
    );

  start =
    Math.max(
      1,
      end - 4
    );

  p.innerHTML =
    button(
      "‹",
      state.page - 1,
      false,
      state.page === 1
    ) +

    Array.from(
      {
        length:
          end - start + 1
      },
      (_, i) => {
        const n =
          start + i;

        return button(
          n,
          n,
          n === state.page
        );
      }
    ).join("") +

    button(
      "›",
      state.page + 1,
      false,
      state.page === totalPages
    );

  p.querySelectorAll(
    "button:not(:disabled)"
  ).forEach(x => {

    x.onclick = async () => {

      state.page =
        +x.dataset.page;

      await loadItems();
    };
  });
}

/* =========================================================
   ATUALIZAR DASHBOARD
========================================================= */

async function refreshDashboard() {
  const b = $("#refresh");

  b.disabled = true;
  b.textContent =
    "Atualizando...";

  try {

    await Promise.all([
      loadSales(),
      loadItems()
    ]);

    toast(
      "Dashboard atualizado."
    );

  } finally {

    b.disabled = false;
    b.textContent =
      "Atualizar";
  }
}

/* =========================================================
   LOGIN
========================================================= */

function initLogin() {
  const form =
    $("#loginForm");

  const input =
    $("#code");

  const error =
    $("#loginError");

  if (!form || !input) {
    return;
  }

  const login = async event => {

    if (event) {
      event.preventDefault();
    }

    const code =
      String(
        input.value || ""
      ).trim();

    if (code !== "8544") {

      error.textContent =
        "Código inválido.";

      input.value = "";
      input.focus();

      return false;
    }

    error.textContent = "";

    sessionStorage.setItem(
      "ml_ok",
      "1"
    );

    input.value = "";

    screen("#stores");

    await loadStores();

    return false;
  };

  form.addEventListener(
    "submit",
    login
  );

  input.addEventListener(
    "input",
    () => {

      input.value =
        input.value
          .replace(/\D/g, "")
          .slice(0, 4);

      error.textContent = "";
    }
  );

  $("#logout").onclick = () => {

    sessionStorage.removeItem(
      "ml_ok"
    );

    screen("#login");

    input.value = "";
    input.focus();
  };
}

function handleOAuthResult() {
  const params =
    new URLSearchParams(
      window.location.search
    );

  const success =
    params.get("oauth");

  const error =
    params.get("oauth_error");

  if (success === "success") {
    toast(
      "Loja conectada com sucesso."
    );

    window.history.replaceState(
      {},
      document.title,
      window.location.pathname
    );

    return;
  }

  if (error) {
    toast(
      `Erro ao conectar loja: ${error}`
    );

    window.history.replaceState(
      {},
      document.title,
      window.location.pathname
    );
  }
}
/* =========================================================
   INICIALIZAÇÃO
========================================================= */

function initApp() {
  initLogin();
  handleOAuthResult();

  $("#back").onclick = () =>
    screen("#stores");

  $("#refresh").onclick =
    refreshDashboard;

  $("#order").onchange =
    async e => {

      state.order =
        e.target.value;

      state.page = 1;

      await loadItems();
    };

  $("#limit").onchange =
    async e => {

      state.limit =
        +e.target.value;

      state.page = 1;

      await loadItems();
    };

  if (
    sessionStorage.getItem(
      "ml_ok"
    ) === "1"
  ) {

    screen("#stores");

    loadStores();

  } else {

    screen("#login");

    $("#code").focus();
  }
}

if (
  document.readyState ===
  "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    initApp
  );

} else {

  initApp();
}