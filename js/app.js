const $ = (s) => document.querySelector(s);

const API_BASE =
  "https://mercado-livre-dashboard-api.mercado-livre-marcelo.workers.dev";

const state = {
  store: null,
  page: 1,
  limit: 48,
  total: 0,
  order: "sold_quantity_desc",
  items: [],
};

/* =========================================================
   UTILITÁRIOS
========================================================= */

const esc = (v) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const money = (v) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(v || 0));

const num = (v) => new Intl.NumberFormat("pt-BR").format(Number(v || 0));

const dt = (v) => {
  if (!v) {
    return "-";
  }

  const d = new Date(v);

  return Number.isNaN(d.getTime())
    ? String(v)
    : new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(d);
};

const screen = (id) => {
  document
    .querySelectorAll(".screen")
    .forEach((x) => x.classList.remove("active"));

  const element = $(id);

  if (element) {
    element.classList.add("active");
  }

  scrollTo(0, 0);
};

const toast = (m) => {
  const element = $("#toast");

  if (!element) {
    return;
  }

  element.textContent = m;
  element.classList.add("show");

  setTimeout(() => element.classList.remove("show"), 3000);
};

/* =========================================================
   API
========================================================= */

const API = {
  async request(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, options);

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Erro HTTP ${response.status}`);
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
        "Content-Type": "application/json",
      },

      body: JSON.stringify(data),
    });
  },

  async items(sellerId, offset, limit, order) {
    const params = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
      order,
    });

    return this.request(
      `/api/stores/${encodeURIComponent(sellerId)}/items?${params.toString()}`,
    );
  },

  async orders(sellerId) {
    return this.request(`/api/stores/${encodeURIComponent(sellerId)}/orders`);
  },

  /*
   * =======================================================
   * RELATÓRIO DE VENDAS
   * =======================================================
   *
   * As datas vêm da tela.
   *
   * offset / limit permitem consultar
   * uma página por vez.
   *
   * O Worker não busca todas as páginas
   * em uma única execução.
   */

  async salesReport(sellerId, from, to, offset = 0, limit = 50) {
    const params = new URLSearchParams({
      from: String(from),
      to: String(to),
      offset: String(offset),
      limit: String(limit),
    });

    return this.request(
      `/api/stores/${encodeURIComponent(
        sellerId,
      )}/reports/sales?${params.toString()}`,
    );
  },

  /*
   * =======================================================
   * RENTABILIDADE
   * =======================================================
   */

  async profitabilityReport(sellerId, from, to, offset = 0, limit = 50) {
    const params = new URLSearchParams({
      from: String(from),
      to: String(to),
      offset: String(offset),
      limit: String(limit),
    });

    return this.request(
      `/api/stores/${encodeURIComponent(
        sellerId,
      )}/reports/profitability?${params.toString()}`,
    );
  },

  async listCosts(sellerId) {
    return this.request(`/api/stores/${encodeURIComponent(sellerId)}/costs`);
  },

  async saveCost(sellerId, itemId, data) {
    return this.request(
      `/api/stores/${encodeURIComponent(
        sellerId,
      )}/costs/${encodeURIComponent(itemId)}`,
      {
        method: "PUT",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify(data),
      },
    );
  },

  async getFiscal(sellerId) {
    return this.request(`/api/stores/${encodeURIComponent(sellerId)}/fiscal`);
  },

  async saveFiscal(sellerId, data) {
    return this.request(`/api/stores/${encodeURIComponent(sellerId)}/fiscal`, {
      method: "PUT",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify(data),
    });
  },
};

/* =========================================================
   ADICIONAR LOJA
========================================================= */

function addStore() {
  window.location.href = `${API_BASE}/api/oauth/start`;
}

/* =========================================================
   LOJAS
========================================================= */

async function loadStores() {
  const g = $("#storesGrid");

  g.innerHTML = '<div class="loading">Carregando lojas...</div>';

  try {
    const d = await API.stores();

    const stores = d.stores || [];

    if (stores.length) {
      g.innerHTML = stores
        .map(
          (x) => `
            <article
              class="store"
              data-id="${esc(x.seller_id)}"
            >
              <div class="logo">
                ${
                  x.logo_url
                    ? `
                      <img
                        src="${esc(x.logo_url)}"
                        alt=""
                      >
                    `
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
          `,
        )
        .join("");
    } else {
      g.innerHTML = '<div class="empty">Nenhuma loja cadastrada.</div>';
    }

    /*
     * Botão adicionar loja
     */

    const addButton = document.createElement("button");

    addButton.type = "button";

    addButton.className = "add-store-button";

    addButton.textContent = "+ Adicionar loja";

    addButton.onclick = addStore;

    g.prepend(addButton);

    /*
     * Clique nas lojas
     */

    g.querySelectorAll(".store").forEach((card) => {
      card.onclick = () => {
        const store = stores.find(
          (x) => String(x.seller_id) === card.dataset.id,
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
   SELETOR DE LOJAS
========================================================= */

function closeStorePicker() {
  const picker = $("#storePicker");

  if (picker) {
    picker.classList.remove("open");

    picker.setAttribute("aria-hidden", "true");
  }
}

function renderStorePicker(stores) {
  const list = $("#storePickerList");

  if (!list) {
    return;
  }

  if (!stores.length) {
    list.innerHTML =
      '<div class="store-picker-empty">Nenhuma loja cadastrada.</div>';

    return;
  }

  list.innerHTML = stores
    .map(
      (store) => `
        <button class="store-picker-option ${
          String(store.seller_id) === String(state.store?.seller_id)
            ? "selected"
            : ""
        }" type="button" data-store-id="${esc(store.seller_id)}">
          <span class="store-picker-logo">
            ${
              store.logo_url
                ? `<img src="${esc(store.logo_url)}" alt="">`
                : "ML"
            }
          </span>
          <span class="store-picker-copy">
            <strong>${esc(store.name || "Loja")}</strong>
            <small>Seller ID: ${esc(store.seller_id)}</small>
          </span>
          <span class="store-picker-arrow">→</span>
        </button>
      `,
    )
    .join("");

  list.querySelectorAll(".store-picker-option").forEach((option) => {
    option.onclick = async () => {
      const store = stores.find(
        (item) => String(item.seller_id) === option.dataset.storeId,
      );

      if (!store) {
        return;
      }

      closeStorePicker();

      await openStore(store);
    };
  });
}

async function showStorePicker() {
  const picker = $("#storePicker");

  const list = $("#storePickerList");

  if (!picker || !list) {
    return;
  }

  picker.classList.add("open");

  picker.setAttribute("aria-hidden", "false");

  list.innerHTML = '<div class="store-picker-empty">Carregando lojas...</div>';

  try {
    const data = await API.stores();

    renderStorePicker(data.stores || []);
  } catch (error) {
    list.innerHTML = `<div class="store-picker-empty">Não foi possível carregar as lojas.<br>${esc(error.message)}</div>`;
  }
}

function initStorePicker() {
  [
    "#itemStoreSwitcher",
    "#reportStoreSwitcher",
    "#catalogStoreSwitcher",
    "#profitStoreSwitcher",
  ].forEach((selector) => {
    const button = $(selector);

    if (button) {
      button.onclick = showStorePicker;
    }
  });

  document.querySelectorAll("[data-close-store-picker]").forEach((button) => {
    button.onclick = closeStorePicker;
  });

  const manage = $("#storePickerManage");

  if (manage) {
    manage.onclick = () => {
      closeStorePicker();

      addStore();
    };
  }
}

/* =========================================================
   ABRIR LOJA
========================================================= */

async function openStore(s) {
  state.store = s;

  state.page = 1;

  state.order = "sold_quantity_desc";

  $("#storeName").textContent = s.name;

  $("#seller").textContent = `Seller ID: ${s.seller_id}`;

  const topName = $("#topStoreName");

  const topSeller = $("#topSeller");

  if (topName) {
    topName.textContent = s.name || "Loja";
  }

  if (topSeller) {
    topSeller.textContent = `Seller ID · ${s.seller_id}`;
  }

  const topAvatar = $("#topAvatar");

  const itemSideName = $("#itemSideStoreName");

  const itemSideAvatar = $("#itemSideAvatar");

  const catalogSideName = $("#catalogSideStoreName");

  const catalogSideAvatar = $("#catalogSideAvatar");

  const catalogStoreName = $("#catalogStoreName");

  if (itemSideName) {
    itemSideName.textContent = s.name || "Loja";
  }

  if (catalogSideName) {
    catalogSideName.textContent = s.name || "Loja";
  }

  if (catalogStoreName) {
    catalogStoreName.textContent = `Produtos publicados em ${s.name || "sua loja"}.`;
  }

  if (topAvatar) {
    topAvatar.innerHTML = s.logo_url
      ? `
          <img
            src="${esc(s.logo_url)}"
            alt=""
          >
        `
      : "ML";
  }

  if (itemSideAvatar) {
    itemSideAvatar.innerHTML = s.logo_url
      ? `
          <img
            src="${esc(s.logo_url)}"
            alt=""
          >
        `
      : "ML";
  }

  if (catalogSideAvatar) {
    catalogSideAvatar.innerHTML = s.logo_url
      ? `
          <img
            src="${esc(s.logo_url)}"
            alt=""
          >
        `
      : "ML";
  }

  $("#logo").innerHTML = s.logo_url
    ? `
        <img
          src="${esc(s.logo_url)}"
          alt=""
        >
      `
    : "ML";

  $("#order").value = state.order;

  screen("#items");

  await Promise.all([loadSales(), loadItems()]);
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
   GRÁFICO PRINCIPAL
========================================================= */

function dayLabel(s) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(`${s}T12:00:00`));
}

function renderCombinedChart(days, summary) {
  const container = $("#combinedChart");

  if (!container) {
    return;
  }

  if (!days.length) {
    container.innerHTML = '<div class="chart-empty">Dados indisponíveis.</div>';

    return;
  }

  const W = 1000;
  const H = 420;

  const L = 58;
  const R = 72;
  const T = 30;
  const B = 68;

  const pw = W - L - R;

  const ph = H - T - B;

  const salesMax = Math.max(...days.map((x) => Number(x.sales || 0)), 1);

  const cancelMax = Math.max(
    ...days.map((x) => Number(x.cancelled || 0)),
    1,
    5,
  );

  const revenueMax = Math.max(...days.map((x) => Number(x.revenue || 0)), 1);

  const x = (i) =>
    L + (days.length === 1 ? pw / 2 : (i / (days.length - 1)) * pw);

  const clampY = (y) => Math.max(T, Math.min(T + ph, y));

  const ySales = (v) => clampY(T + ph - (Number(v || 0) / salesMax) * ph);

  const yCancel = (v) => clampY(T + ph - (Number(v || 0) / cancelMax) * ph);

  const yRevenue = (v) => clampY(T + ph - (Number(v || 0) / revenueMax) * ph);

  const path = (key, y) =>
    days
      .map(
        (d, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(d[key]).toFixed(1)}`,
      )
      .join(" ");

  const salesPath = path("sales", ySales);

  const revenuePath = path("revenue", yRevenue);

  const cancelPath = path("cancelled", yCancel);

  const grid = Array.from(
    {
      length: 5,
    },
    (_, i) => {
      const ratio = i / 4;

      const yy = T + ph - ratio * ph;

      const salesVal = Math.round(salesMax * ratio);

      const revVal = revenueMax * ratio;

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
    },
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
              x="${xx - 22}"
              y="${T}"
              width="44"
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

        <defs>
          <clipPath id="chartPlotClip">
            <rect
              x="${L}"
              y="${T}"
              width="${pw}"
              height="${ph}"
            />
          </clipPath>
        </defs>

        ${grid}

        <line
          x1="${L}"
          y1="${T + ph}"
          x2="${W - R}"
          y2="${T + ph}"
          class="chart-axis"
        />

        <g clip-path="url(#chartPlotClip)">

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

        </g>

        ${labels}

      </svg>

      <div
        id="chartTooltip"
        class="chart-tooltip"
      ></div>

    </div>
  `;

  const salesTotal = $("#chartSalesTotal");

  const revenueTotal = $("#chartRevenueTotal");

  const cancelledTotal = $("#chartCancelledTotal");

  if (salesTotal) {
    salesTotal.textContent = `${num(summary.sales)} vendas`;
  }

  if (revenueTotal) {
    revenueTotal.textContent = money(summary.revenue);
  }

  if (cancelledTotal) {
    cancelledTotal.textContent = `${num(summary.cancelled)} cancelamentos`;
  }

  const tooltip = $("#chartTooltip");

  if (!tooltip) {
    return;
  }

  container.querySelectorAll(".point-group").forEach((group) => {
    group.addEventListener("mouseenter", () => {
      const i = Number(group.dataset.index);

      const d = days[i];

      tooltip.innerHTML = `
            <strong>
              ${dayLabel(d.date)}
            </strong>

            <span class="tt-sales">
              <i></i>
              Vendas:
              <b>
                ${num(d.sales)}
              </b>
            </span>

            <span class="tt-revenue">
              <i></i>
              Faturamento:
              <b>
                ${money(d.revenue)}
              </b>
            </span>

            <span class="tt-cancel">
              <i></i>
              Cancelamentos:
              <b>
                ${num(d.cancelled)}
              </b>
            </span>
          `;

      tooltip.classList.add("visible");

      const ratio = days.length <= 1 ? 0.5 : i / (days.length - 1);

      const chartWidth = container.clientWidth;

      const tooltipWidth = 170;

      const rawLeft = ratio * chartWidth;

      const safeLeft = Math.max(
        tooltipWidth / 2 + 8,
        Math.min(chartWidth - tooltipWidth / 2 - 8, rawLeft),
      );

      tooltip.style.left = `${safeLeft}px`;

      tooltip.style.top = "10px";
    });

    group.addEventListener("mouseleave", () =>
      tooltip.classList.remove("visible"),
    );
  });
}

/* =========================================================
   STATUS
========================================================= */

function renderStatus(x) {
  const a = [
    ["Pendentes", x.pending_shipping, "pending"],
    ["Enviados", x.shipped, "shipped"],
    ["Entregues", x.delivered, "delivered"],
    ["Cancelados", x.cancelled, "cancelled"],
  ];

  const max = Math.max(...a.map((v) => Number(v[1] || 0)), 1);

  $("#statusBars").innerHTML = a
    .map(
      (v) => `
          <div
            class="status-row"
          >

            <div
              class="status-label"
            >
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

            <div
              class="status-track"
            >
              <div
                class="status-fill ${v[2]}"
                style="width:${Math.max(2, (Number(v[1] || 0) / max) * 100)}%"
              ></div>
            </div>

          </div>
        `,
    )
    .join("");
}

/* =========================================================
   VENDAS
========================================================= */

async function loadSales() {
  try {
    const d = await API.orders(state.store.seller_id);

    renderSummaryCards(d.summary || {});

    renderCombinedChart(
      (d.daily || []).map((x) => ({
        ...x,
        cancelled: Number(x.cancelled || 0),
      })),
      d.summary || {},
    );

    renderStatus(d.summary || {});

    const f = d.period?.from
      ? new Date(d.period.from).toLocaleDateString("pt-BR")
      : "";

    const t = d.period?.to
      ? new Date(d.period.to).toLocaleDateString("pt-BR")
      : "";

    const period = $("#salesPeriod");

    if (period) {
      period.textContent = f && t ? `${f} até ${t}` : "";
    }
  } catch (e) {
    $("#summaryCards").innerHTML = `
      <div
        class="sales-error"
      >
        <strong>
          Não foi possível carregar o resumo de vendas.
        </strong>

        <span>
          ${esc(e.message)}
        </span>
      </div>
    `;

    if ($("#combinedChart")) {
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

  const table = $(".catalog-table-wrap");

  $("#loading").style.display = "block";

  if (table) {
    table.style.display = "none";
  }

  g.innerHTML = "";

  $("#pages").innerHTML = "";

  try {
    const d = await API.items(
      state.store.seller_id,
      (state.page - 1) * state.limit,
      state.limit,
      state.order,
    );

    state.items = d.items || [];

    state.total = Number(d.paging?.total || 0);

    renderItems();

    renderPages();

    const a = state.total ? (state.page - 1) * state.limit + 1 : 0;

    const b = Math.min(state.page * state.limit, state.total);

    $("#summary").textContent = `${num(a)}–${num(b)} de ${num(
      state.total,
    )} anúncios`;
  } catch (e) {
    g.innerHTML = `
      <tr>
        <td class="catalog-table-empty" colspan="9">
          <strong>Erro ao carregar anúncios</strong><br>
          ${esc(e.message)}
        </td>
      </tr>
    `;
  } finally {
    $("#loading").style.display = "none";

    if (table) {
      table.style.display = "block";
    }
  }
}

/* =========================================================
   IMAGENS
========================================================= */

function imgs(x) {
  return (x.pictures || []).map((p) => p.secure_url || p.url).filter(Boolean);
}

const galleryState = {
  images: [],
  index: 0,
};

function updateItemGallery() {
  const image = $("#itemGalleryImage");

  const empty = $("#itemGalleryEmpty");

  const count = $("#itemGalleryCount");

  const prev = $("#itemGalleryPrev");

  const next = $("#itemGalleryNext");

  const total = galleryState.images.length;

  if (!total) {
    image.removeAttribute("src");

    image.style.display = "none";

    empty.style.display = "grid";

    count.textContent = "";

    prev.hidden = true;

    next.hidden = true;

    return;
  }

  image.src = galleryState.images[galleryState.index];

  image.style.display = "block";

  empty.style.display = "none";

  count.textContent = `${galleryState.index + 1} de ${total} fotos`;

  prev.hidden = total < 2;

  next.hidden = total < 2;
}

function closeItemGallery() {
  const gallery = $("#itemGallery");

  if (gallery) {
    gallery.classList.remove("open");

    gallery.setAttribute("aria-hidden", "true");
  }
}

function openItemGallery(item) {
  const gallery = $("#itemGallery");

  if (!gallery || !item) {
    return;
  }

  galleryState.images = imgs(item);

  if (!galleryState.images.length && item.thumbnail) {
    galleryState.images = [item.thumbnail];
  }

  galleryState.index = 0;

  $("#itemGalleryTitle").textContent = item.title || "Anúncio";

  const link = $("#itemGalleryLink");

  if (item.permalink) {
    link.href = item.permalink;

    link.style.display = "inline-flex";
  } else {
    link.removeAttribute("href");

    link.style.display = "none";
  }

  updateItemGallery();

  gallery.classList.add("open");

  gallery.setAttribute("aria-hidden", "false");
}

function initItemGallery() {
  document.querySelectorAll("[data-close-gallery]").forEach((button) => {
    button.onclick = closeItemGallery;
  });

  $("#itemGalleryPrev").onclick = () => {
    const total = galleryState.images.length;

    galleryState.index = (galleryState.index - 1 + total) % total;

    updateItemGallery();
  };

  $("#itemGalleryNext").onclick = () => {
    const total = galleryState.images.length;

    galleryState.index = (galleryState.index + 1) % total;

    updateItemGallery();
  };

  document.addEventListener("keydown", (event) => {
    if (!$("#itemGallery")?.classList.contains("open")) {
      return;
    }

    if (event.key === "Escape") {
      closeItemGallery();
    }
  });
}

/* =========================================================
   SKU
========================================================= */

function sku(x) {
  return (
    (x.attributes || []).find((a) => a.id === "SELLER_SKU")?.value_name || "-"
  );
}

/* =========================================================
   RENDER ANÚNCIOS
========================================================= */

function renderItems() {
  const g = $("#grid");

  if (!state.items.length) {
    g.innerHTML = `
      <tr>
        <td class="catalog-table-empty" colspan="9">
          Nenhum anúncio encontrado.
        </td>
      </tr>
    `;

    return;
  }

  g.innerHTML = state.items
    .map((x, index) => {
      const src = x.thumbnail || imgs(x)[0] || "";

      const available = Number(x.available_quantity || 0);

      const stockClass = available <= 0 ? "out" : available < 10 ? "low" : "";

      return `
        <tr class="catalog-item-row" data-item-index="${index}">
          <td>
            <div class="catalog-product">
              <div class="catalog-product-image">
                ${
                  src
                    ? `<img src="${esc(src)}" alt="" loading="lazy">`
                    : "<span>ML</span>"
                }
              </div>
              <div class="catalog-product-copy">
                <strong>${esc(x.title)}</strong>
                <span>${esc(x.id)} · ${esc(x.condition || "novo")}</span>
              </div>
            </div>
          </td>
          <td class="catalog-sku">${esc(sku(x))}</td>
          <td class="catalog-date catalog-dates">
            <span>Criado: ${esc(dt(x.date_created))}</span>
            <span>Atuali: ${esc(dt(x.last_updated))}</span>
          </td>
          <td class="catalog-price">${money(x.price)}</td>
          <td><span class="catalog-stock ${stockClass}">${num(available)}</span></td>
          <td>${num(x.sold_quantity)}</td>
          <td><span class="catalog-status">${esc(x.status || "active")}</span></td>
          <td class="catalog-action">
            ${
              x.permalink
                ? `<a href="${esc(x.permalink)}" target="_blank" rel="noopener" aria-label="Abrir anúncio no Mercado Livre" title="Abrir anúncio no Mercado Livre">↗</a>`
                : "—"
            }
          </td>
        </tr>
          `;
    })
    .join("");

  g.querySelectorAll(".catalog-item-row").forEach((row) => {
    row.onclick = (event) => {
      if (event.target.closest("a")) {
        return;
      }

      openItemGallery(state.items[Number(row.dataset.itemIndex)]);
    };
  });
}

/* =========================================================
   PAGINAÇÃO
========================================================= */

function renderPages() {
  const p = $("#pages");

  const totalPages = Math.ceil(state.total / state.limit);

  if (totalPages < 2) {
    return;
  }

  const button = (label, page, active = false, disabled = false) => `
    <button
      data-page="${page}"
      class="${active ? "active" : ""}"
      ${disabled ? "disabled" : ""}
    >
      ${label}
    </button>
  `;

  let start = Math.max(1, state.page - 2);

  let end = Math.min(totalPages, start + 4);

  start = Math.max(1, end - 4);

  p.innerHTML =
    button("‹", state.page - 1, false, state.page === 1) +
    Array.from(
      {
        length: end - start + 1,
      },
      (_, i) => {
        const n = start + i;

        return button(n, n, n === state.page);
      },
    ).join("") +
    button("›", state.page + 1, false, state.page === totalPages);

  p.querySelectorAll("button:not(:disabled)").forEach((x) => {
    x.onclick = async () => {
      state.page = +x.dataset.page;

      await loadItems();
    };
  });
}

/* =========================================================
   RELATÓRIOS
========================================================= */

const reportState = {
  loading: false,

  from: "",

  to: "",

  products: new Map(),

  monthly: new Map(),

  summary: {
    sales: 0,

    revenue: 0,

    units: 0,

    cancelled: 0,
  },
};

/* =========================================================
   ABRIR RELATÓRIOS
========================================================= */

function openReports() {
  if (!state.store) {
    toast("Nenhuma loja selecionada.");

    return;
  }

  const store = state.store;

  const name = $("#reportStoreName");

  const seller = $("#reportSeller");

  const topName = $("#reportTopStoreName");

  const topSeller = $("#reportTopSeller");

  const logo = $("#reportLogo");

  const topAvatar = $("#reportTopAvatar");

  const sideName = $("#reportSideStoreName");

  const sideAvatar = $("#reportSideAvatar");

  if (name) {
    name.textContent = store.name || "Loja";
  }

  if (seller) {
    seller.textContent = `Seller ID: ${store.seller_id}`;
  }

  if (topName) {
    topName.textContent = store.name || "Loja";
  }

  if (topSeller) {
    topSeller.textContent = `Seller ID · ${store.seller_id}`;
  }

  if (sideName) {
    sideName.textContent = store.name || "Loja";
  }

  if (logo) {
    logo.innerHTML = store.logo_url
      ? `
          <img
            src="${esc(store.logo_url)}"
            alt=""
          >
        `
      : "ML";
  }

  if (topAvatar) {
    topAvatar.innerHTML = store.logo_url
      ? `
          <img
            src="${esc(store.logo_url)}"
            alt=""
          >
        `
      : "ML";
  }

  if (sideAvatar) {
    sideAvatar.innerHTML = store.logo_url
      ? `
          <img
            src="${esc(store.logo_url)}"
            alt=""
          >
        `
      : "ML";
  }

  /*
   * Datas padrão:
   *
   * Data inicial e data final sempre
   * começam na data de hoje.
   *
   * As datas continuam editáveis
   * pelo usuário na tela.
   */

  const today = new Date();

  const todayValue = today.toISOString().slice(0, 10);

  const from = $("#reportFrom");

  const to = $("#reportTo");

  if (from && !from.value) {
    from.value = todayValue;
  }

  if (to && !to.value) {
    to.value = todayValue;
  }

  screen("#reports");
}

/* =========================================================
   FECHAR RELATÓRIOS
========================================================= */

function closeReports(destination = "dashboard") {
  if (destination === "catalog") {
    openCatalog();

    return;
  }

  screen("#items");
}

function openCatalog() {
  if (!state.store) {
    toast("Nenhuma loja selecionada.");

    return;
  }

  screen("#catalog");
}

/* =========================================================
   RESET RELATÓRIO
========================================================= */

function resetReportState() {
  reportState.products = new Map();

  reportState.monthly = new Map();

  reportState.summary = {
    sales: 0,

    revenue: 0,

    units: 0,

    cancelled: 0,
  };
}

/* =========================================================
   MESCLAR PRODUTO
========================================================= */

function mergeReportProduct(product) {
  if (!product?.item_id) {
    return;
  }

  const id = String(product.item_id);

  const quantity = Number(product.sold_quantity || 0);

  const revenue = Number(product.revenue || 0);

  const orders = Number(product.orders || 0);

  const current = reportState.products.get(id);

  /*
   * Primeira ocorrência
   */

  if (!current) {
    reportState.products.set(id, {
      ...product,

      item_id: id,

      sold_quantity: quantity,

      revenue: revenue,

      orders: orders,

      price: Number(product.price || 0),

      available_quantity: Number(product.available_quantity || 0),

      status: product.status || "",

      permalink: product.permalink || "",

      thumbnail: product.thumbnail || "",

      pictures: Array.isArray(product.pictures) ? product.pictures : [],
    });

    return;
  }

  /*
   * Acumula vendas
   */

  current.sold_quantity += quantity;

  current.revenue += revenue;

  current.orders += orders;

  /*
   * Completa dados
   */

  if (!current.title && product.title) {
    current.title = product.title;
  }

  if (!current.thumbnail && product.thumbnail) {
    current.thumbnail = product.thumbnail;
  }

  if (!current.permalink && product.permalink) {
    current.permalink = product.permalink;
  }

  if (
    (!Array.isArray(current.pictures) || !current.pictures.length) &&
    Array.isArray(product.pictures)
  ) {
    current.pictures = product.pictures;
  }

  if (!current.price && product.price) {
    current.price = Number(product.price);
  }

  if (!current.available_quantity && product.available_quantity) {
    current.available_quantity = Number(product.available_quantity);
  }

  if (!current.status && product.status) {
    current.status = product.status;
  }
}

/* =========================================================
   MESCLAR MÊS
========================================================= */

function mergeReportMonth(month) {
  if (!month?.month) {
    return;
  }

  const key = String(month.month);

  const current = reportState.monthly.get(key);

  if (!current) {
    reportState.monthly.set(key, {
      ...month,

      sales: Number(month.sales || 0),

      units: Number(month.units || 0),

      revenue: Number(month.revenue || 0),
    });

    return;
  }

  current.sales += Number(month.sales || 0);

  current.units += Number(month.units || 0);

  current.revenue += Number(month.revenue || 0);
}

/* =========================================================
   MESCLAR PÁGINA DO RELATÓRIO
========================================================= */

function mergeReportPage(report) {
  if (!report) {
    return;
  }

  const summary = report.summary || {};

  /*
   * =======================================================
   * RESUMO
   * =======================================================
   */

  reportState.summary.sales += Number(summary.sales || 0);

  reportState.summary.revenue += Number(summary.revenue || 0);

  reportState.summary.units += Number(summary.units_sold || 0);

  reportState.summary.cancelled += Number(summary.cancelled || 0);

  /*
   * =======================================================
   * PRODUTOS
   * =======================================================
   *
   * O Worker retorna:
   *
   * report.products
   *
   * O Map consolida todas as páginas.
   */

  if (Array.isArray(report.products)) {
    for (const product of report.products) {
      mergeReportProduct(product);
    }
  }

  /*
   * =======================================================
   * COMPATIBILIDADE COM WORKER ANTIGO
   * =======================================================
   */

  const legacyLists = [
    report.most_sold,

    report.least_sold,

    report.highest_revenue,

    report.lowest_revenue,
  ];

  for (const list of legacyLists) {
    if (!Array.isArray(list)) {
      continue;
    }

    for (const product of list) {
      mergeReportProduct(product);
    }
  }

  /*
   * =======================================================
   * MESES
   * =======================================================
   */

  if (Array.isArray(report.monthly)) {
    for (const month of report.monthly) {
      mergeReportMonth(month);
    }
  }
}

/* =========================================================
   CARREGAR RELATÓRIO
========================================================= */

async function loadReport() {
  if (reportState.loading) {
    return;
  }

  if (!state.store) {
    toast("Nenhuma loja selecionada.");

    return;
  }

  /*
   * As datas vêm diretamente
   * dos campos da tela.
   */

  const from = $("#reportFrom")?.value;

  const to = $("#reportTo")?.value;

  if (!from || !to) {
    toast("Informe a data inicial e final.");

    return;
  }

  if (from > to) {
    toast("A data inicial não pode ser maior que a data final.");

    return;
  }

  reportState.loading = true;

  reportState.from = from;

  reportState.to = to;

  resetReportState();

  setReportLoading(true);

  try {
    let offset = 0;

    /*
     * O Worker aceita no máximo
     * 50 pedidos por chamada.
     */

    const limit = 50;

    let total = 0;

    let processed = 0;

    while (true) {
      /*
       * Cada chamada busca somente
       * uma página.
       */

      const report = await API.salesReport(
        state.store.seller_id,
        from,
        to,
        offset,
        limit,
      );

      mergeReportPage(report);

      const paging = report.paging || {};

      total = Number(paging.total || total || 0);

      processed += Number(paging.returned || 0);

      updateReportProgress(processed, total);

      /*
       * Última página
       */

      if (!paging.has_more) {
        break;
      }

      const nextOffset = Number(paging.next_offset);

      /*
       * Segurança contra
       * loop infinito.
       */

      if (!Number.isFinite(nextOffset) || nextOffset <= offset) {
        break;
      }

      offset = nextOffset;
    }

    renderReport();

    toast("Relatório atualizado.");
  } catch (error) {
    console.error("Erro no relatório:", error);

    toast(error?.message || "Erro ao carregar relatório.");
  } finally {
    reportState.loading = false;

    setReportLoading(false);
  }
}

/* =========================================================
   LOADING DO RELATÓRIO
========================================================= */

function setReportLoading(loading) {
  const loadingElement = $("#reportLoading");

  const progress = $("#reportProgress");

  if (loadingElement) {
    loadingElement.style.display = loading ? "flex" : "none";
  }

  if (progress) {
    progress.style.display = loading ? "block" : "none";
  }
}

/* =========================================================
   PROGRESSO
========================================================= */

function updateReportProgress(processed, total) {
  let percentage = 0;

  if (total > 0) {
    percentage = Math.min(100, Math.round((processed / total) * 100));
  }

  const count = $("#reportProgressCount");

  const bar = $("#reportProgressBar");

  const text = $("#reportLoadingText");

  if (count) {
    count.textContent = `${percentage}%`;
  }

  if (bar) {
    bar.style.width = `${percentage}%`;
  }

  if (text) {
    text.textContent = `${num(processed)} de ${num(total)} pedidos analisados.`;
  }
}

/* =========================================================
   RENDER RELATÓRIO
========================================================= */

function renderReport() {
  renderReportSummary();

  renderReportMonthly();

  const products = [...reportState.products.values()];

  /*
   * =======================================================
   * MAIS VENDIDOS
   * =======================================================
   */

  const mostSold = [...products]
    .sort(
      (a, b) =>
        Number(b.sold_quantity || 0) - Number(a.sold_quantity || 0) ||
        Number(b.revenue || 0) - Number(a.revenue || 0),
    )
    .slice(0, 10);

  /*
   * =======================================================
   * MENOS VENDIDOS
   * =======================================================
   */

  const leastSold = [...products]
    .sort(
      (a, b) =>
        Number(a.sold_quantity || 0) - Number(b.sold_quantity || 0) ||
        Number(a.revenue || 0) - Number(b.revenue || 0),
    )
    .slice(0, 10);

  /*
   * =======================================================
   * MAIOR FATURAMENTO
   * =======================================================
   */

  const highestRevenue = [...products]
    .sort(
      (a, b) =>
        Number(b.revenue || 0) - Number(a.revenue || 0) ||
        Number(b.sold_quantity || 0) - Number(a.sold_quantity || 0),
    )
    .slice(0, 10);

  /*
   * =======================================================
   * MENOR FATURAMENTO
   * =======================================================
   */

  const lowestRevenue = [...products]
    .sort(
      (a, b) =>
        Number(a.revenue || 0) - Number(b.revenue || 0) ||
        Number(a.sold_quantity || 0) - Number(b.sold_quantity || 0),
    )
    .slice(0, 10);

  renderReportRanking("#reportMostSold", mostSold, false);

  renderReportRanking("#reportLeastSold", leastSold, false);

  renderReportRanking("#reportHighestRevenue", highestRevenue, true);

  renderReportRanking("#reportLowestRevenue", lowestRevenue, true);

  const label = $("#reportPeriodLabel");

  if (label) {
    label.textContent = `${reportDateLabel(
      reportState.from,
    )} → ${reportDateLabel(reportState.to)}`;
  }
}

/* =========================================================
   RESUMO DO RELATÓRIO
========================================================= */

function renderReportSummary() {
  const sales = $("#reportSales");

  const revenue = $("#reportRevenue");

  const units = $("#reportUnits");

  const cancelled = $("#reportCancelled");

  if (sales) {
    sales.textContent = num(reportState.summary.sales);
  }

  if (revenue) {
    revenue.textContent = money(reportState.summary.revenue);
  }

  if (units) {
    units.textContent = num(reportState.summary.units);
  }

  if (cancelled) {
    cancelled.textContent = num(reportState.summary.cancelled);
  }
}

/* =========================================================
   DATA DO RELATÓRIO
========================================================= */

function reportDateLabel(value) {
  if (!value) {
    return "";
  }

  const parts = value.split("-");

  if (parts.length !== 3) {
    return value;
  }

  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/* =========================================================
   RANKINGS
========================================================= */

function renderReportRanking(selector, products, revenueMode = false) {
  const container = $(selector);

  if (!container) {
    return;
  }

  if (!products.length) {
    container.innerHTML = `
      <div class="report-empty">
        Nenhum produto encontrado.
      </div>
    `;

    return;
  }

  container.innerHTML = products
    .map((product, index) => {
      const title = esc(product.title || product.item_id || "Produto");

      const quantity = num(product.sold_quantity);

      const revenue = money(product.revenue);

      const thumbnail = product.thumbnail || imgs(product)[0] || "";

      const permalink = product.permalink || "";

      const image = thumbnail
        ? `
                <img
                  src="${esc(thumbnail)}"
                  alt=""
                  loading="lazy"
                >
              `
        : `
                <div
                  class="report-product-placeholder"
                >
                  ${index + 1}
                </div>
              `;

      return `
            <div
              class="report-product-row${permalink ? "" : " no-link"}"
              data-permalink="${esc(permalink)}"
              data-thumbnail="${esc(thumbnail)}"
              data-title="${title}"
            >

              <div
                class="report-product-rank"
              >
                ${index + 1}
              </div>

              <div
                class="report-product-image"
              >
                ${image}
              </div>

              <div
                class="report-product-info"
              >

                <strong>
                  ${title}
                </strong>

                <span>
                  ${quantity}
                  unidade${Number(product.sold_quantity || 0) === 1 ? "" : "s"}
                </span>

              </div>

              <div
                class="report-product-value"
              >
                ${revenueMode ? revenue : `${quantity} un.`}
              </div>

            </div>
          `;
    })
    .join("");

  container.querySelectorAll(".report-product-row").forEach((row) => {
    row.addEventListener("click", () => {
      const permalink = row.dataset.permalink;

      if (permalink) {
        window.open(permalink, "_blank", "noopener");
      }
    });

    row.addEventListener("mouseenter", () => showReportPreview(row));

    row.addEventListener("mousemove", (event) => positionReportPreview(event));

    row.addEventListener("mouseleave", hideReportPreview);
  });
}

/* =========================================================
   PREVIEW DO PRODUTO (RELATÓRIO)
========================================================= */

function showReportPreview(row) {
  const preview = $("#reportPreview");

  if (!preview) {
    return;
  }

  const image = $("#reportPreviewImage");

  const title = $("#reportPreviewTitle");

  const thumbnail = row.dataset.thumbnail;

  if (image) {
    if (thumbnail) {
      image.src = thumbnail;

      image.style.display = "block";
    } else {
      image.removeAttribute("src");

      image.style.display = "none";
    }
  }

  if (title) {
    title.textContent = row.dataset.title || "";
  }

  preview.classList.add("visible");
}

function positionReportPreview(event) {
  const preview = $("#reportPreview");

  if (!preview || !preview.classList.contains("visible")) {
    return;
  }

  const offset = 18;

  const rect = preview.getBoundingClientRect();

  const maxLeft = window.innerWidth - rect.width - 10;

  const maxTop = window.innerHeight - rect.height - 10;

  const left = Math.min(event.clientX + offset, Math.max(10, maxLeft));

  const top = Math.min(event.clientY + offset, Math.max(10, maxTop));

  preview.style.left = `${left}px`;

  preview.style.top = `${top}px`;
}

function hideReportPreview() {
  const preview = $("#reportPreview");

  if (preview) {
    preview.classList.remove("visible");
  }
}

/* =========================================================
   GRÁFICO MENSAL
========================================================= */

function renderReportMonthly() {
  const container = $("#reportMonthlyChart");

  if (!container) {
    return;
  }

  const months = [...reportState.monthly.values()].sort((a, b) =>
    a.month.localeCompare(b.month),
  );

  if (!months.length) {
    container.innerHTML = `
      <div class="report-empty">
        Nenhuma venda encontrada no período.
      </div>
    `;

    return;
  }

  const max = Math.max(...months.map((x) => Number(x.sales || 0)), 1);

  container.innerHTML = `
    <div
      class="report-monthly-bars"
    >

      ${months
        .map((month) => {
          const sales = Number(month.sales || 0);

          const units = Number(month.units || 0);

          const revenue = Number(month.revenue || 0);

          const height = Math.max(4, Math.round((sales / max) * 100));

          const label = month.label || month.month;

          return `
            <div
              class="report-month-column"
              title="${esc(
                `${label}: ${num(sales)} vendas • ${num(
                  units,
                )} unidades • ${money(revenue)}`,
              )}"
            >

              <div
                class="report-month-value"
              >
                ${num(sales)}
              </div>

              <div
                class="report-month-bar-area"
              >
                <div
                  class="report-month-bar"
                  style="height:${height}%"
                ></div>
              </div>

              <span>
                ${esc(label)}
              </span>

            </div>
          `;
        })
        .join("")}

    </div>
  `;
}

/* =========================================================
   RENTABILIDADE
========================================================= */

const profitState = {
  loading: false,

  from: "",

  to: "",

  /*
   * item_id -> agregados brutos (reais) somados
   * de todas as páginas do relatório.
   */
  raw: new Map(),

  /*
   * item_id -> { product_cost, packaging_cost,
   * other_costs, shipping_cost, ads_cost }
   */
  costConfigs: {},

  /*
   * Configuração fiscal da loja (ou null se
   * ainda não configurada).
   */
  fiscal: null,
};

/*
 * =======================================================
 * ALÍQUOTA DE IMPOSTOS
 * =======================================================
 *
 * Retorna null quando não há configuração fiscal —
 * impostos nunca viram 0% sozinhos.
 */
function computeTaxRate(fiscal) {
  if (!fiscal) {
    return null;
  }

  if (fiscal.regime === "simples_nacional") {
    return Number.isFinite(fiscal.simples_percent)
      ? fiscal.simples_percent
      : null;
  }

  const rates = [
    fiscal.icms_percent,
    fiscal.icms_st_percent,
    fiscal.pis_percent,
    fiscal.cofins_percent,
    fiscal.ipi_percent,
  ].filter((rate) => Number.isFinite(rate));

  if (!rates.length) {
    return null;
  }

  return rates.reduce((sum, rate) => sum + rate, 0);
}

/*
 * =======================================================
 * CÁLCULO DE LUCRO/MARGEM POR ANÚNCIO
 * =======================================================
 *
 * Regra: custo do produto e configuração fiscal
 * são OBRIGATÓRIOS para calcular lucro/margem.
 * Sem eles, profit/margin ficam null (N/D) — nunca
 * tratamos como zero.
 *
 * Embalagem, outros custos, frete e publicidade
 * são opcionais: quando não informados entram como
 * 0 no cálculo, mas ficam listados em
 * "optional_missing" para a tela avisar o usuário.
 */
function computeItemProfitability(agg, costConfig, fiscal) {
  const missing = [];

  const hasProductCost = costConfig && Number.isFinite(costConfig.product_cost);

  const taxRate = computeTaxRate(fiscal);

  if (!hasProductCost) {
    missing.push("custo do produto");
  }

  if (taxRate === null) {
    missing.push("configuração fiscal");
  }

  const packagingUnit =
    costConfig && Number.isFinite(costConfig.packaging_cost)
      ? costConfig.packaging_cost
      : null;

  const otherUnit =
    costConfig && Number.isFinite(costConfig.other_costs)
      ? costConfig.other_costs
      : null;

  const shippingPerOrder =
    costConfig && Number.isFinite(costConfig.shipping_cost)
      ? costConfig.shipping_cost
      : null;

  const adsTotal =
    costConfig && Number.isFinite(costConfig.ads_cost)
      ? costConfig.ads_cost
      : null;

  const packaging = (packagingUnit || 0) * agg.quantity;

  const otherCosts = (otherUnit || 0) * agg.quantity;

  const shipping = (shippingPerOrder || 0) * agg.orders;

  const ads = adsTotal || 0;

  const optionalMissing = [
    packagingUnit === null ? "embalagem" : null,
    otherUnit === null ? "outros custos" : null,
    shippingPerOrder === null ? "frete" : null,
    adsTotal === null ? "publicidade" : null,
  ].filter(Boolean);

  const productCostTotal = hasProductCost
    ? costConfig.product_cost * agg.quantity
    : null;

  const taxes = taxRate !== null ? (agg.net_revenue * taxRate) / 100 : null;

  let profit = null;

  let margin = null;

  if (hasProductCost && taxRate !== null) {
    profit =
      agg.net_revenue -
      agg.ml_fee -
      taxes -
      shipping -
      ads -
      productCostTotal -
      packaging -
      otherCosts;

    margin = agg.net_revenue > 0 ? (profit / agg.net_revenue) * 100 : null;
  }

  const targetMargin =
    fiscal && Number.isFinite(fiscal.target_margin) ? fiscal.target_margin : 15;

  let classification = "sem_dados";

  if (profit !== null && margin !== null) {
    if (margin < 0) {
      classification = "prejuizo";
    } else if (margin < targetMargin) {
      classification = "atencao";
    } else {
      classification = "excelente";
    }
  }

  return {
    taxes,

    shipping: shippingPerOrder !== null ? shipping : null,

    ads: adsTotal !== null ? ads : null,

    packaging: packagingUnit !== null ? packaging : null,

    other_costs: otherUnit !== null ? otherCosts : null,

    product_cost: productCostTotal,

    profit,

    margin,

    classification,

    missing,

    optional_missing: optionalMissing,
  };
}

/* =========================================================
   ABRIR TELA DE RENTABILIDADE
========================================================= */

async function openProfitability() {
  if (!state.store) {
    toast("Nenhuma loja selecionada.");

    return;
  }

  const store = state.store;

  const setStoreBadge = (nameId, sellerId, logoId) => {
    const nameEl = $(nameId);

    const logoEl = $(logoId);

    if (nameEl) {
      nameEl.textContent = store.name || "Loja";
    }

    if (logoEl) {
      logoEl.innerHTML = store.logo_url
        ? `<img src="${esc(store.logo_url)}" alt="">`
        : "ML";
    }
  };

  setStoreBadge("#profitStoreName", store.seller_id, "#profitLogo");

  setStoreBadge("#profitSideStoreName", store.seller_id, "#profitSideAvatar");

  const seller = $("#profitSeller");

  if (seller) {
    seller.textContent = `Seller ID: ${store.seller_id}`;
  }

  const today = new Date();

  const todayValue = today.toISOString().slice(0, 10);

  const from = $("#profitFrom");

  const to = $("#profitTo");

  if (from && !from.value) {
    from.value = todayValue;
  }

  if (to && !to.value) {
    to.value = todayValue;
  }

  screen("#profitability");

  try {
    const [costsResponse, fiscalResponse] = await Promise.all([
      API.listCosts(store.seller_id),

      API.getFiscal(store.seller_id),
    ]);

    profitState.costConfigs = costsResponse.costs || {};

    profitState.fiscal = fiscalResponse.fiscal || null;

    if (profitState.raw.size) {
      renderProfitability();
    }
  } catch (error) {
    toast(error?.message || "Erro ao carregar configurações de rentabilidade.");
  }
}

function closeProfitability(destination = "dashboard") {
  if (destination === "catalog") {
    openCatalog();

    return;
  }

  if (destination === "reports") {
    openReports();

    return;
  }

  screen("#items");
}

/* =========================================================
   CARREGAR RELATÓRIO DE RENTABILIDADE
========================================================= */

async function loadProfitability() {
  if (profitState.loading) {
    return;
  }

  if (!state.store) {
    toast("Nenhuma loja selecionada.");

    return;
  }

  const from = $("#profitFrom")?.value;

  const to = $("#profitTo")?.value;

  if (!from || !to) {
    toast("Informe a data inicial e final.");

    return;
  }

  if (from > to) {
    toast("A data inicial não pode ser maior que a data final.");

    return;
  }

  profitState.loading = true;

  profitState.from = from;

  profitState.to = to;

  profitState.raw = new Map();

  setProfitLoading(true);

  try {
    let offset = 0;

    const limit = 50;

    let total = 0;

    let processed = 0;

    while (true) {
      const report = await API.profitabilityReport(
        state.store.seller_id,
        from,
        to,
        offset,
        limit,
      );

      mergeProfitPage(report);

      const paging = report.paging || {};

      total = Number(paging.total || total || 0);

      processed += Number(paging.returned || 0);

      updateProfitProgress(processed, total);

      if (!paging.has_more) {
        break;
      }

      const nextOffset = Number(paging.next_offset);

      if (!Number.isFinite(nextOffset) || nextOffset <= offset) {
        break;
      }

      offset = nextOffset;
    }

    renderProfitability();

    toast("Análise de rentabilidade atualizada.");
  } catch (error) {
    console.error("Erro na rentabilidade:", error);

    toast(error?.message || "Erro ao carregar rentabilidade.");
  } finally {
    profitState.loading = false;

    setProfitLoading(false);
  }
}

function mergeProfitPage(report) {
  if (!report || !Array.isArray(report.products)) {
    return;
  }

  for (const product of report.products) {
    const id = String(product.item_id || "");

    if (!id) {
      continue;
    }

    const current = profitState.raw.get(id);

    if (!current) {
      profitState.raw.set(id, {
        item_id: id,

        title: product.title || "",

        permalink: product.permalink || "",

        thumbnail: product.thumbnail || "",

        quantity: Number(product.quantity || 0),

        orders: Number(product.orders || 0),

        net_revenue: Number(product.net_revenue || 0),

        gross_revenue: Number(product.gross_revenue || 0),

        discount: Number(product.discount || 0),

        ml_fee: Number(product.ml_fee || 0),
      });

      continue;
    }

    current.quantity += Number(product.quantity || 0);

    current.orders += Number(product.orders || 0);

    current.net_revenue += Number(product.net_revenue || 0);

    current.gross_revenue += Number(product.gross_revenue || 0);

    current.discount += Number(product.discount || 0);

    current.ml_fee += Number(product.ml_fee || 0);

    if (!current.title && product.title) {
      current.title = product.title;
    }

    if (!current.thumbnail && product.thumbnail) {
      current.thumbnail = product.thumbnail;
    }

    if (!current.permalink && product.permalink) {
      current.permalink = product.permalink;
    }
  }
}

function setProfitLoading(loading) {
  const loadingElement = $("#profitLoading");

  const progress = $("#profitProgress");

  if (loadingElement) {
    loadingElement.style.display = loading ? "flex" : "none";
  }

  if (progress) {
    progress.style.display = loading ? "block" : "none";
  }
}

function updateProfitProgress(processed, total) {
  let percentage = 0;

  if (total > 0) {
    percentage = Math.min(100, Math.round((processed / total) * 100));
  }

  const count = $("#profitProgressCount");

  const bar = $("#profitProgressBar");

  const text = $("#profitLoadingText");

  if (count) {
    count.textContent = `${percentage}%`;
  }

  if (bar) {
    bar.style.width = `${percentage}%`;
  }

  if (text) {
    text.textContent = `${num(processed)} de ${num(total)} pedidos analisados.`;
  }
}

/* =========================================================
   RENDER — RENTABILIDADE
========================================================= */

function profitClassificationLabel(classification) {
  return (
    {
      excelente: "🟢 Excelente",

      atencao: "🟡 Atenção",

      prejuizo: "🔴 Prejuízo",

      sem_dados: "⚪ Sem dados",
    }[classification] || "⚪ Sem dados"
  );
}

function ndCell(value, formatter, missingReasons) {
  if (value === null || value === undefined) {
    const reason = (missingReasons || []).join(", ") || "dado não configurado";

    return `<span class="profit-nd" title="N/D — ${esc(reason)}">N/D</span>`;
  }

  return formatter(value);
}

function computeAllProfitability() {
  const items = [...profitState.raw.values()].map((agg) => {
    const costConfig = profitState.costConfigs[agg.item_id] || null;

    const financials = computeItemProfitability(
      agg,
      costConfig,
      profitState.fiscal,
    );

    return {
      ...agg,

      ...financials,

      has_cost_config: Boolean(costConfig),
    };
  });

  items.sort((a, b) => b.net_revenue - a.net_revenue);

  return items;
}

function renderProfitability() {
  const items = computeAllProfitability();

  renderProfitSummary(items);

  renderProfitTable(items);

  const label = $("#profitPeriodLabel");

  if (label) {
    label.textContent = `${reportDateLabel(profitState.from)} → ${reportDateLabel(
      profitState.to,
    )}`;
  }
}

function renderProfitSummary(items) {
  const container = $("#profitSummaryCards");

  if (!container) {
    return;
  }

  const totals = items.reduce(
    (acc, item) => {
      acc.gross_revenue += item.gross_revenue;

      acc.net_revenue += item.net_revenue;

      acc.discount += item.discount;

      acc.ml_fee += item.ml_fee;

      if (item.taxes !== null) {
        acc.taxes += item.taxes;
      } else {
        acc.taxes_missing = true;
      }

      if (item.shipping !== null) {
        acc.shipping += item.shipping;
      }

      if (item.ads !== null) {
        acc.ads += item.ads;
      }

      if (item.product_cost !== null) {
        acc.product_cost += item.product_cost;
      } else {
        acc.cost_missing = true;
      }

      if (item.profit !== null) {
        acc.profit += item.profit;

        acc.items_with_profit += 1;
      }

      return acc;
    },
    {
      gross_revenue: 0,

      net_revenue: 0,

      discount: 0,

      ml_fee: 0,

      taxes: 0,

      taxes_missing: false,

      shipping: 0,

      ads: 0,

      product_cost: 0,

      cost_missing: false,

      profit: 0,

      items_with_profit: 0,
    },
  );

  const hasFullProfit =
    items.length > 0 && totals.items_with_profit === items.length;

  const margin =
    hasFullProfit && totals.net_revenue > 0
      ? (totals.profit / totals.net_revenue) * 100
      : null;

  const cards = [
    ["FATURAMENTO BRUTO", money(totals.gross_revenue), null],

    ["RECEITA LÍQUIDA", money(totals.net_revenue), null],

    ["TARIFAS MERCADO LIVRE", money(totals.ml_fee), null],

    ["DESCONTOS", money(totals.discount), null],

    ["FRETE (INFORMADO)", money(totals.shipping), null],

    ["PUBLICIDADE (INFORMADO)", money(totals.ads), null],

    [
      "IMPOSTOS",
      totals.taxes_missing
        ? ndCell(null, money, ["configuração fiscal"])
        : money(totals.taxes),
      null,
    ],

    [
      "CUSTO DO PRODUTO",
      totals.cost_missing
        ? ndCell(null, money, ["custo do produto em 1 ou mais anúncios"])
        : money(totals.product_cost),
      null,
    ],

    [
      "LUCRO LÍQUIDO",
      hasFullProfit
        ? money(totals.profit)
        : ndCell(null, money, ["custo do produto ou configuração fiscal"]),
      null,
    ],

    [
      "MARGEM LÍQUIDA",
      margin !== null
        ? `${margin.toFixed(1)}%`
        : ndCell(null, () => "", ["custo do produto ou configuração fiscal"]),
      null,
    ],
  ];

  container.innerHTML = cards
    .map(
      ([label, value]) => `
        <div class="stat-card">
          <small>${label}</small>
          <strong>${value}</strong>
        </div>
      `,
    )
    .join("");
}

function renderProfitTable(items) {
  const body = $("#profitTableBody");

  if (!body) {
    return;
  }

  if (!items.length) {
    body.innerHTML = `
      <tr>
        <td class="catalog-table-empty" colspan="11">
          Nenhuma venda encontrada no período. Gere a análise acima.
        </td>
      </tr>
    `;

    return;
  }

  body.innerHTML = items
    .map((item) => {
      const title = esc(item.title || item.item_id || "Produto");

      const image = item.thumbnail
        ? `<img src="${esc(item.thumbnail)}" alt="" loading="lazy">`
        : "<span>ML</span>";

      return `
        <tr>
          <td>
            <div class="catalog-product">
              <div class="catalog-product-image">${image}</div>
              <div class="catalog-product-copy">
                <strong>${title}</strong>
                <span>${esc(item.item_id)}</span>
              </div>
            </div>
          </td>
          <td>${num(item.quantity)}</td>
          <td class="catalog-price">${money(item.net_revenue)}</td>
          <td class="catalog-price">${money(item.ml_fee)}</td>
          <td class="catalog-price">${ndCell(item.shipping, money, ["frete"])}</td>
          <td class="catalog-price">${ndCell(item.ads, money, ["publicidade"])}</td>
          <td class="catalog-price">${ndCell(item.taxes, money, ["configuração fiscal"])}</td>
          <td class="catalog-price">${ndCell(item.product_cost, money, ["custo do produto"])}</td>
          <td class="catalog-price">${ndCell(item.profit, money, item.missing)}</td>
          <td>${item.margin !== null ? `${item.margin.toFixed(1)}%` : ndCell(null, () => "", item.missing)}</td>
          <td><span class="profit-badge ${item.classification}">${profitClassificationLabel(item.classification)}</span></td>
          <td class="catalog-action">
            <button type="button" class="profit-config-btn" data-config-item="${esc(item.item_id)}">
              Configurar custos
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  body.querySelectorAll("[data-config-item]").forEach((button) => {
    button.onclick = () => openCostModal(button.dataset.configItem);
  });
}

/* =========================================================
   MODAL — CUSTOS DO ANÚNCIO
========================================================= */

function openCostModal(itemId) {
  const modal = $("#costModal");

  if (!modal) {
    return;
  }

  const item = profitState.raw.get(itemId);

  const config = profitState.costConfigs[itemId] || {};

  const titleEl = $("#costModalTitle");

  if (titleEl) {
    titleEl.textContent = item?.title || itemId;
  }

  modal.dataset.itemId = itemId;

  const fields = {
    "#costProductCost": config.product_cost,

    "#costPackaging": config.packaging_cost,

    "#costOther": config.other_costs,

    "#costShipping": config.shipping_cost,

    "#costAds": config.ads_cost,
  };

  Object.entries(fields).forEach(([selector, value]) => {
    const input = $(selector);

    if (input) {
      input.value = value === null || value === undefined ? "" : value;
    }
  });

  modal.classList.add("open");

  modal.setAttribute("aria-hidden", "false");
}

function closeCostModal() {
  const modal = $("#costModal");

  if (modal) {
    modal.classList.remove("open");

    modal.setAttribute("aria-hidden", "true");
  }
}

async function saveCostModal() {
  const modal = $("#costModal");

  const itemId = modal?.dataset.itemId;

  if (!itemId || !state.store) {
    return;
  }

  const readField = (selector) => {
    const input = $(selector);

    const value = input ? input.value.trim() : "";

    return value === "" ? null : value;
  };

  const data = {
    product_cost: readField("#costProductCost"),

    packaging_cost: readField("#costPackaging"),

    other_costs: readField("#costOther"),

    shipping_cost: readField("#costShipping"),

    ads_cost: readField("#costAds"),
  };

  try {
    const response = await API.saveCost(state.store.seller_id, itemId, data);

    profitState.costConfigs[itemId] = response.config;

    closeCostModal();

    renderProfitability();

    toast("Custos do anúncio salvos.");
  } catch (error) {
    toast(error?.message || "Erro ao salvar custos.");
  }
}

/* =========================================================
   MODAL — CONFIGURAÇÃO FISCAL
========================================================= */

function updateFiscalRegimeFields() {
  const regime = $("#fiscalRegime")?.value || "outros";

  const simplesGroup = $("#fiscalSimplesGroup");

  const outrosGroup = $("#fiscalOutrosGroup");

  if (simplesGroup) {
    simplesGroup.style.display =
      regime === "simples_nacional" ? "grid" : "none";
  }

  if (outrosGroup) {
    outrosGroup.style.display = regime === "simples_nacional" ? "none" : "grid";
  }
}

function openFiscalModal() {
  if (!state.store) {
    toast("Nenhuma loja selecionada.");

    return;
  }

  const modal = $("#fiscalModal");

  if (!modal) {
    return;
  }

  const fiscal = profitState.fiscal || {};

  const setValue = (selector, value) => {
    const input = $(selector);

    if (input) {
      input.value = value === null || value === undefined ? "" : value;
    }
  };

  const regimeInput = $("#fiscalRegime");

  if (regimeInput) {
    regimeInput.value =
      fiscal.regime === "simples_nacional" ? "simples_nacional" : "outros";
  }

  setValue("#fiscalSimplesPercent", fiscal.simples_percent);

  setValue("#fiscalIcms", fiscal.icms_percent);

  setValue("#fiscalIcmsSt", fiscal.icms_st_percent);

  setValue("#fiscalPis", fiscal.pis_percent);

  setValue("#fiscalCofins", fiscal.cofins_percent);

  setValue("#fiscalIpi", fiscal.ipi_percent);

  setValue("#fiscalTargetMargin", fiscal.target_margin);

  updateFiscalRegimeFields();

  modal.classList.add("open");

  modal.setAttribute("aria-hidden", "false");
}

function closeFiscalModal() {
  const modal = $("#fiscalModal");

  if (modal) {
    modal.classList.remove("open");

    modal.setAttribute("aria-hidden", "true");
  }
}

async function saveFiscalModal() {
  if (!state.store) {
    return;
  }

  const readField = (selector) => {
    const input = $(selector);

    const value = input ? input.value.trim() : "";

    return value === "" ? null : value;
  };

  const data = {
    regime:
      $("#fiscalRegime")?.value === "simples_nacional"
        ? "simples_nacional"
        : "outros",

    simples_percent: readField("#fiscalSimplesPercent"),

    icms_percent: readField("#fiscalIcms"),

    icms_st_percent: readField("#fiscalIcmsSt"),

    pis_percent: readField("#fiscalPis"),

    cofins_percent: readField("#fiscalCofins"),

    ipi_percent: readField("#fiscalIpi"),

    target_margin: readField("#fiscalTargetMargin"),
  };

  try {
    const response = await API.saveFiscal(state.store.seller_id, data);

    profitState.fiscal = response.fiscal;

    closeFiscalModal();

    renderProfitability();

    toast("Configuração fiscal salva.");
  } catch (error) {
    toast(error?.message || "Erro ao salvar configuração fiscal.");
  }
}

/* =========================================================
   EVENTOS DA RENTABILIDADE
========================================================= */

function initProfitability() {
  const itemOpen = $("#itemProfitability");

  const catalogOpen = $("#catalogProfitability");

  const reportOpen = $("#reportProfitability");

  const generateButton = $("#generateProfitability");

  const profitDashboard = $("#profitDashboard");

  const profitReports = $("#profitReports");

  const profitCatalog = $("#profitCatalog");

  const profitMobileBack = $("#profitMobileBack");

  const openFiscalButton = $("#openFiscalConfig");

  [itemOpen, catalogOpen, reportOpen].forEach((button) => {
    if (button) {
      button.onclick = openProfitability;
    }
  });

  if (generateButton) {
    generateButton.onclick = loadProfitability;
  }

  if (profitDashboard) {
    profitDashboard.onclick = () => closeProfitability("dashboard");
  }

  if (profitReports) {
    profitReports.onclick = () => closeProfitability("reports");
  }

  if (profitCatalog) {
    profitCatalog.onclick = () => closeProfitability("catalog");
  }

  if (profitMobileBack) {
    profitMobileBack.onclick = () => closeProfitability("dashboard");
  }

  if (openFiscalButton) {
    openFiscalButton.onclick = openFiscalModal;
  }

  document.querySelectorAll("[data-close-cost-modal]").forEach((button) => {
    button.onclick = closeCostModal;
  });

  document.querySelectorAll("[data-close-fiscal-modal]").forEach((button) => {
    button.onclick = closeFiscalModal;
  });

  const costSave = $("#costModalSave");

  if (costSave) {
    costSave.onclick = saveCostModal;
  }

  const fiscalSave = $("#fiscalModalSave");

  if (fiscalSave) {
    fiscalSave.onclick = saveFiscalModal;
  }

  const fiscalRegime = $("#fiscalRegime");

  if (fiscalRegime) {
    fiscalRegime.onchange = updateFiscalRegimeFields;
  }
}

/* =========================================================
   EVENTOS DOS RELATÓRIOS
========================================================= */

function initReports() {
  const openButton = $("#openReports");

  const itemOpenButton = $("#itemOpenReports");

  const backButton = $("#reportsBack");

  const generateButton = $("#generateReport");

  const catalogButton = $("#reportCatalog");

  const mobileBackButton = $("#reportMobileBack");

  if (openButton) {
    openButton.onclick = openReports;
  }

  if (itemOpenButton) {
    itemOpenButton.onclick = openReports;
  }

  if (backButton) {
    backButton.onclick = closeReports;
  }

  if (catalogButton) {
    catalogButton.onclick = () => closeReports("catalog");
  }

  if (mobileBackButton) {
    mobileBackButton.onclick = closeReports;
  }

  if (generateButton) {
    generateButton.onclick = loadReport;
  }
}

function initItemsNavigation() {
  const catalog = $("#itemsCatalog");

  const mobileStores = $("#itemMobileStores");

  if (catalog) {
    catalog.onclick = openCatalog;
  }

  if (mobileStores) {
    mobileStores.onclick = async () => {
      screen("#stores");

      await loadStores();
    };
  }
}

function initCatalogNavigation() {
  const dashboard = $("#catalogDashboard");

  const reports = $("#catalogReports");

  const mobileDashboard = $("#catalogMobileDashboard");

  if (dashboard) {
    dashboard.onclick = () => screen("#items");
  }

  if (reports) {
    reports.onclick = openReports;
  }

  if (mobileDashboard) {
    mobileDashboard.onclick = () => screen("#items");
  }
}

/* =========================================================
   ATUALIZAR DASHBOARD
========================================================= */

async function refreshDashboard() {
  const b = $("#refresh");

  if (!b) {
    return;
  }

  b.disabled = true;

  b.textContent = "Atualizando...";

  try {
    await Promise.all([loadSales(), loadItems()]);

    toast("Dashboard atualizado.");
  } finally {
    b.disabled = false;

    b.textContent = "Atualizar";
  }
}

async function openInitialDashboard() {
  try {
    const data = await API.stores();

    const stores = data.stores || [];

    if (stores.length) {
      await openStore(stores[0]);

      return;
    }
  } catch (error) {
    console.error("Erro ao carregar lojas:", error);
  }

  screen("#stores");

  await loadStores();

  toast("Conecte uma loja para visualizar o dashboard.");
}

/* =========================================================
   LOGIN
========================================================= */

function initLogin() {
  const form = $("#loginForm");

  const input = $("#code");

  const error = $("#loginError");

  if (!form || !input) {
    return;
  }

  const login = async (event) => {
    if (event) {
      event.preventDefault();
    }

    const code = String(input.value || "").trim();

    if (code !== "8544") {
      error.textContent = "Código inválido.";

      input.value = "";

      input.focus();

      return false;
    }

    error.textContent = "";

    sessionStorage.setItem("ml_ok", "1");

    input.value = "";

    await openInitialDashboard();

    return false;
  };

  form.addEventListener("submit", login);

  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(0, 4);

    error.textContent = "";
  });

  const logout = $("#logout");

  const reportLogout = $("#reportLogout");

  const itemLogout = $("#itemLogout");

  const catalogLogout = $("#catalogLogout");

  const profitLogout = $("#profitLogout");

  const logoutUser = () => {
    sessionStorage.removeItem("ml_ok");

    state.store = null;

    screen("#login");

    input.value = "";

    input.focus();
  };

  if (logout) {
    logout.onclick = logoutUser;
  }

  if (reportLogout) {
    reportLogout.onclick = logoutUser;
  }

  if (itemLogout) {
    itemLogout.onclick = logoutUser;
  }

  if (catalogLogout) {
    catalogLogout.onclick = logoutUser;
  }

  if (profitLogout) {
    profitLogout.onclick = logoutUser;
  }
}

/* =========================================================
   RESULTADO DO OAUTH
========================================================= */

async function handleOAuthResult() {
  const params = new URLSearchParams(window.location.search);

  const success = params.get("oauth");

  const error = params.get("oauth_error");

  if (success === "success") {
    window.history.replaceState({}, document.title, window.location.pathname);

    await openInitialDashboard();

    toast("Loja conectada com sucesso.");

    return;
  }

  if (error) {
    window.history.replaceState({}, document.title, window.location.pathname);

    toast(`Erro ao conectar loja: ${error}`);
  }
}

/* =========================================================
   INICIALIZAÇÃO
========================================================= */

async function initApp() {
  initLogin();

  initReports();

  initProfitability();

  initItemsNavigation();

  initCatalogNavigation();

  initStorePicker();

  initItemGallery();

  await handleOAuthResult();

  const back = $("#back");

  if (back) {
    back.onclick = () => screen("#stores");
  }

  const refresh = $("#refresh");

  if (refresh) {
    refresh.onclick = refreshDashboard;
  }

  const order = $("#order");

  if (order) {
    order.onchange = async (e) => {
      state.order = e.target.value;

      state.page = 1;

      await loadItems();
    };
  }

  const limit = $("#limit");

  if (limit) {
    limit.onchange = async (e) => {
      state.limit = +e.target.value;

      state.page = 1;

      await loadItems();
    };
  }

  if (sessionStorage.getItem("ml_ok") === "1") {
    openInitialDashboard();
  } else {
    screen("#login");

    const code = $("#code");

    if (code) {
      code.focus();
    }
  }
}

/* =========================================================
   START
========================================================= */

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
