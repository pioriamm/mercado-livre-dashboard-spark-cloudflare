window.API = (() => {
  const request = async (path) => {
    const base = window.APP_CONFIG.apiBaseUrl.replace(/\/$/, "");

    const response = await fetch(base + path);

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    return data;
  };

  return {
    /*
     * =======================================================
     * LOJAS
     * =======================================================
     */

    stores: () => request("/api/stores"),

    /*
     * =======================================================
     * ANÚNCIOS
     * =======================================================
     */

    items: (sellerId, offset, limit, order) =>
      request(
        `/api/stores/${encodeURIComponent(
          sellerId,
        )}/items?offset=${offset}&limit=${limit}&order=${encodeURIComponent(
          order,
        )}`,
      ),

    /*
     * =======================================================
     * PEDIDOS
     * =======================================================
     */

    orders: (sellerId) =>
      request(`/api/stores/${encodeURIComponent(sellerId)}/orders`),

    /*
     * =======================================================
     * RELATÓRIO DE VENDAS
     * =======================================================
     *
     * O relatório é paginado.
     *
     * from:
     *   YYYY-MM-DD
     *
     * to:
     *   YYYY-MM-DD
     *
     * offset:
     *   0, 50, 100...
     *
     * limit:
     *   máximo 50
     *
     * Exemplo:
     *
     * API.salesReport(
     *   "680763285",
     *   "2026-01-01",
     *   "2026-08-31",
     *   0,
     *   50,
     * );
     */

    salesReport: (sellerId, from, to, offset = 0, limit = 50) => {
      const params = new URLSearchParams();

      params.set("from", from);

      params.set("to", to);

      params.set("offset", String(Math.max(0, Number(offset) || 0)));

      params.set(
        "limit",
        String(Math.min(50, Math.max(1, Number(limit) || 50))),
      );

      return request(
        `/api/stores/${encodeURIComponent(
          sellerId,
        )}/reports/sales?${params.toString()}`,
      );
    },
  };
})();
