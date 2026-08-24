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
    list.innerHTML = '<div class="store-picker-empty">Nenhuma loja cadastrada.</div>';

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
  ["#itemStoreSwitcher", "#reportStoreSwitcher", "#catalogStoreSwitcher"].forEach((selector) => {
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
   * primeiro dia do ano atual
   * até a data atual.
   *
   * As datas continuam editáveis
   * pelo usuário na tela.
   */

  const today = new Date();

  const start = new Date(today.getFullYear(), 0, 1);

  const from = $("#reportFrom");

  const to = $("#reportTo");

  if (from && !from.value) {
    from.value = start.toISOString().slice(0, 10);
  }

  if (to && !to.value) {
    to.value = today.toISOString().slice(0, 10);
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

      const image = product.thumbnail
        ? `
                <img
                  src="${esc(product.thumbnail)}"
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
              class="report-product-row"
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
