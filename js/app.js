// Dataset ICA Colombia: consulta por libro (departamento, municipio, columna) y administración
// (carga de CSV, edición y eliminación de registros, guardado en GitHub).
(function () {
  "use strict";

  const { sheets } = window.APP_CONFIG;
  const GH = window.GitHubStore;
  const $ = (id) => document.getElementById(id);

  const state = {
    route: { slug: sheets[0].slug, dep: "", mun: "", col: "", mode: "consulta" },
    cache: {},              // slug -> { data, sha, saved, dirty, edits: WeakMap(row -> Set(col)) }
    loading: false,
  };

  // ---------- Utilidades ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fold = (c) => c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const norm = (s) => fold(String(s ?? "")).trim();
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });
  const fmtDate = (iso) => new Date(iso).toLocaleString("es-CO", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  const plural = (n, one, many) => `${n.toLocaleString("es-CO")} ${n === 1 ? one : many}`;
  const isNumeric = (v) => /^-?\d+([.,]\d+)?%?$/.test(v);
  const isNA = (v) => /^(n\/?a|no aplica|-+)$/i.test(String(v).trim());
  const sheetBySlug = (slug) => sheets.find((s) => s.slug === slug) || sheets[0];
  const entry = () => state.cache[state.route.slug];

  // Nombre de columna "Grupo — Subcolumna" en sus dos partes.
  function splitName(name) {
    const i = name.indexOf(" — ");
    return i === -1 ? { grp: "", sub: name } : { grp: name.slice(0, i), sub: name.slice(i + 3) };
  }

  // Resalta la búsqueda sin importar tildes ni mayúsculas.
  function highlight(text, query) {
    const q = norm(query);
    if (!q) return esc(text);
    const s = String(text);
    const folded = Array.from(s).map((c) => fold(c).charAt(0) || c).join("");
    const at = folded.indexOf(q);
    if (at === -1 || folded.length !== s.length) return esc(s);
    return esc(s.slice(0, at)) + "<mark>" + esc(s.slice(at, at + q.length)) + "</mark>" + esc(s.slice(at + q.length));
  }

  function toast(msg, type = "") {
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = msg;
    $("toasts").appendChild(el);
    setTimeout(() => el.remove(), type === "error" ? 8000 : 4000);
  }

  // Posición de las columnas de identificación en cada libro (no todos tienen N°).
  function idCols(columns) {
    const c = columns.map(norm);
    return {
      n: c.indexOf("n°"),
      dane: c.findIndex((x) => x.includes("codigo dane")),
      dep: c.indexOf("departamento"),
      mun: c.indexOf("municipio"),
      acuerdo: c.indexOf("acuerdo"),
      anio: c.findIndex((x) => x.startsWith("ano de actualizacion")),
    };
  }

  // ---------- Rutas: #libro?dep=…&mun=…&col=…&modo=admin ----------
  function parseHash() {
    const [slug, qs] = location.hash.slice(1).split("?");
    const p = new URLSearchParams(qs || "");
    return {
      slug: sheets.some((s) => s.slug === slug) ? slug : sheets[0].slug,
      dep: p.get("dep") || "",
      mun: p.get("mun") || "",
      col: p.get("col") || "",
      mode: p.get("modo") === "admin" ? "admin" : "consulta",
    };
  }
  function buildHash(r) {
    const p = new URLSearchParams();
    if (r.dep) p.set("dep", r.dep);
    if (r.mun) p.set("mun", r.mun);
    if (r.col) p.set("col", r.col);
    if (r.mode === "admin") p.set("modo", "admin");
    const qs = p.toString();
    return `#${r.slug}${qs ? `?${qs}` : ""}`;
  }
  function go(partial, { push = false } = {}) {
    const prevSlug = state.route.slug;
    state.route = { ...state.route, ...partial };
    const hash = buildHash(state.route);
    if (push) history.pushState(null, "", hash);
    else history.replaceState(null, "", hash);
    if (state.route.slug !== prevSlug) openBook();
    else render();
  }

  // ---------- Datos ----------
  async function loadBook(sheet) {
    if (state.cache[sheet.slug]) return state.cache[sheet.slug];
    let data = null;
    let sha = null;
    if (GH.hasToken()) ({ data, sha } = await GH.getFile(sheet.slug));
    else data = await GH.getPublic(sheet.slug);
    data = data || { sheet: sheet.name, updatedAt: null, sourceFile: null, columns: [], rows: [] };
    const e = { data, sha, saved: clone(data), dirty: false, edits: new WeakMap() };
    state.cache[sheet.slug] = e;
    return e;
  }

  async function openBook() {
    const sheet = sheetBySlug(state.route.slug);
    state.loading = true;
    state.loadError = null;
    render();
    try {
      await loadBook(sheet);
    } catch (e) {
      state.loadError = e.message;
    }
    state.loading = false;
    if (state.route.slug === sheet.slug) render();
  }

  function filteredRows(data) {
    const id = idCols(data.columns);
    const { dep, mun } = state.route;
    return data.rows
      .map((row, i) => ({ row, i }))
      .filter(({ row }) => (!dep || row[id.dep] === dep) && (!mun || row[id.mun] === mun));
  }

  function matchesColumn(name) {
    const words = norm(state.route.col).split(/\s+/).filter(Boolean);
    const n = norm(name);
    return words.every((w) => n.includes(w));
  }

  // ---------- Render ----------
  function render() {
    const sheet = sheetBySlug(state.route.slug);
    const admin = state.route.mode === "admin";
    document.title = `${sheet.name} · Dataset ICA Colombia`;

    document.querySelectorAll(".mode-tab").forEach((a) => {
      const on = a.dataset.mode === state.route.mode;
      a.toggleAttribute("aria-current", on);
      if (on) a.setAttribute("aria-current", "page");
      a.href = buildHash({ ...state.route, mode: a.dataset.mode });
    });
    $("connectBtn").classList.toggle("on", GH.hasToken());
    $("connectLabel").textContent = GH.hasToken() ? "Conectado a GitHub" : "Conectar GitHub";

    renderNav();
    $("bookTitle").textContent = sheet.name;
    $("adminStrip").hidden = !admin;

    const e = entry();
    if (state.loading || !e) {
      $("bookMeta").textContent = sheet.desc;
      $("titleActions").innerHTML = "";
      renderFilters(null);
      $("content").innerHTML = skeleton();
      return;
    }
    if (state.loadError) {
      $("bookMeta").textContent = sheet.desc;
      $("titleActions").innerHTML = "";
      $("content").innerHTML = `<div class="state"><strong>No se pudo cargar ${esc(sheet.name)}</strong><span class="muted">${esc(state.loadError)}</span><br><button class="text-btn" data-act="retry" type="button">Reintentar</button></div>`;
      return;
    }

    renderFilters(e.data);
    renderTitle(sheet, e);
    renderSummary();

    const { data } = e;
    if (!data.rows.length) {
      $("content").innerHTML = `<div class="state"><strong>Este libro todavía no tiene registros</strong>${admin
        ? `<span class="muted">Sube el CSV exportado de la hoja “${esc(sheet.name)}” del Excel.</span>`
        : `<span class="muted">Cuando el equipo suba el CSV de “${esc(sheet.name)}”, sus municipios aparecerán aquí.</span><br><a class="text-btn" href="${buildHash({ ...state.route, mode: "admin" })}">Ir a administración</a>`}</div>`;
      return;
    }
    const rows = filteredRows(data);
    if (!rows.length) {
      const who = state.route.mun || state.route.dep;
      $("content").innerHTML = `<div class="state"><strong>${esc(who)} no aparece en ${esc(sheet.name)}</strong><span class="muted">Este libro tiene ${plural(data.rows.length, "registro", "registros")}; prueba con otro municipio o limpia la búsqueda.</span><br><button class="text-btn" data-act="clear" type="button">Limpiar búsqueda</button></div>`;
      return;
    }
    if (state.route.mun) renderFichas(data, rows, admin);
    else renderTable(data, rows, admin);
  }

  function renderNav() {
    $("bookNav").innerHTML = sheets.map((s) => {
      const current = s.slug === state.route.slug ? ' aria-current="page"' : "";
      const pending = state.cache[s.slug]?.dirty ? '<span class="pending" title="Cambios sin guardar"></span>' : "";
      return `<a href="${buildHash({ ...state.route, slug: s.slug })}" data-slug="${s.slug}"${current}><span>${esc(s.name)}</span>${pending}</a>`;
    }).join("");
  }

  function renderFilters(data) {
    const depSel = $("depSelect");
    const munSel = $("munSelect");
    if ($("colInput").value !== state.route.col) $("colInput").value = state.route.col;
    if (!data || !data.rows.length) {
      depSel.innerHTML = `<option value="">Todos</option>`;
      munSel.innerHTML = `<option value="">Todos</option>`;
      depSel.disabled = munSel.disabled = true;
      return;
    }
    depSel.disabled = munSel.disabled = false;
    const id = idCols(data.columns);
    const { dep, mun } = state.route;
    const deps = [...new Set(data.rows.map((r) => r[id.dep]).filter(Boolean))].sort(collator.compare);
    if (dep && !deps.includes(dep)) deps.push(dep);
    const muns = [...new Set(data.rows.filter((r) => !dep || r[id.dep] === dep).map((r) => r[id.mun]).filter(Boolean))].sort(collator.compare);
    if (mun && !muns.includes(mun)) muns.push(mun);
    depSel.innerHTML = `<option value="">Todos (${deps.length})</option>` + deps.map((d) => `<option${d === dep ? " selected" : ""}>${esc(d)}</option>`).join("");
    munSel.innerHTML = `<option value="">Todos (${muns.length})</option>` + muns.map((m) => `<option${m === mun ? " selected" : ""}>${esc(m)}</option>`).join("");
  }

  function renderTitle(sheet, e) {
    const { data } = e;
    const admin = state.route.mode === "admin";
    const id = idCols(data.columns);
    const total = data.rows.length;
    const shown = filteredRows(data).length;
    const dataCols = data.columns.filter((_, i) => ![id.n, id.dane, id.dep, id.mun].includes(i));
    const colsShown = state.route.col ? dataCols.filter(matchesColumn).length : dataCols.length;

    const parts = [];
    parts.push(shown === total ? plural(total, "municipio", "municipios") : `${shown} de ${plural(total, "municipio", "municipios")}`);
    parts.push(state.route.col ? `${colsShown} de ${plural(dataCols.length, "columna", "columnas")} con “${state.route.col}”` : plural(dataCols.length, "columna", "columnas"));
    if (data.updatedAt) parts.push(`actualizado ${fmtDate(data.updatedAt)}`);
    $("bookMeta").textContent = total ? parts.join(" · ") : sheet.desc;

    const active = [state.route.dep, state.route.mun, state.route.col].filter(Boolean).length;
    let html = total ? `<button class="btn mobile-only" data-act="filters" type="button" aria-controls="sidebar">Buscar${active ? ` (${active})` : ""}</button>` : "";
    if (admin) {
      if (e.dirty) {
        html += `<span class="unsaved">Cambios sin guardar</span>
          <button class="btn" data-act="discard" type="button">Descartar</button>
          <button class="btn btn-primary" data-act="save" type="button" id="saveBtn">Guardar en GitHub</button>`;
      } else {
        html += `<button class="btn" data-act="new" type="button"${total ? "" : " disabled"}>Nuevo registro</button>`;
      }
    } else if (total) {
      html += `<button class="btn" data-act="download" type="button">Descargar CSV</button>`;
    }
    $("titleActions").innerHTML = html;
  }

  function renderSummary() {
    const { dep, mun, col } = state.route;
    const chips = [];
    if (dep) chips.push(["dep", dep]);
    if (mun) chips.push(["mun", mun]);
    if (col) chips.push(["col", `Columna: ${col}`]);
    $("filterSummary").hidden = !chips.length;
    $("filterSummary").innerHTML = chips.map(([k, v]) => `<span class="chip">${esc(v)}<button type="button" data-unset="${k}" aria-label="Quitar ${esc(v)}">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></span>`).join("");
  }

  function skeleton() {
    const row = `<tr>${"<td><div></div></td>".repeat(6)}</tr>`;
    return `<div class="table-wrap"><table class="skeleton"><tbody>${row.repeat(8)}</tbody></table></div>`;
  }

  // Tabla: municipio fijo a la izquierda, luego departamento y código DANE, luego las columnas que coinciden.
  function renderTable(data, rows, admin) {
    const id = idCols(data.columns);
    const lead = [id.mun, id.dep, id.dane].filter((i) => i >= 0);
    const rest = data.columns.map((_, i) => i).filter((i) => !lead.includes(i) && i !== id.n && (!state.route.col || matchesColumn(data.columns[i])));
    const cols = lead.concat(rest);
    const numeric = new Set(cols.filter((c) => {
      const vals = rows.map(({ row }) => row[c]).filter((v) => v !== "" && v != null && !isNA(v));
      return vals.length && vals.every(isNumeric);
    }));
    const edits = entry().edits;

    const head = cols.map((c) => {
      const { grp, sub } = splitName(data.columns[c]);
      const cls = [c === id.mun ? "stick" : "", numeric.has(c) ? "num" : ""].filter(Boolean).join(" ");
      return `<th${cls ? ` class="${cls}"` : ""} title="${esc(data.columns[c])}"><div class="th-text">${grp ? `<span class="grp">${highlight(grp, state.route.col)}</span>` : ""}<span class="sub">${highlight(sub, state.route.col)}</span></div></th>`;
    }).join("") + (admin ? `<th class="col-actions"><span class="sr-only">Acciones</span></th>` : "");

    const body = rows.map(({ row, i }) => {
      const changed = edits.get(row);
      const tds = cols.map((c) => {
        const v = row[c] ?? "";
        const cls = [
          c === id.mun ? "stick" : "",
          numeric.has(c) ? "num" : "",
          c === id.dane ? "id-col" : "",
          changed && changed.has(c) ? "edited" : "",
        ].filter(Boolean).join(" ");
        let inner;
        if (v === "") inner = `<span class="dash">—</span>`;
        else if (norm(v) === "no" || isNA(v)) inner = `<span class="no">${esc(v)}</span>`;
        else inner = `<div class="cell${v.length > 120 || v.includes("\n") ? " long" : ""}">${esc(v)}</div>`;
        return `<td${cls ? ` class="${cls}"` : ""}>${inner}</td>`;
      }).join("");
      const actions = admin ? `<td class="col-actions"><div class="row-actions">
        <button class="icon-only" type="button" data-edit="${i}" aria-label="Editar ${esc(row[id.mun])}" title="Editar">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg></button>
        <button class="icon-only del" type="button" data-delete="${i}" aria-label="Eliminar ${esc(row[id.mun])}" title="Eliminar">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg></button>
      </div></td>` : "";
      return `<tr>${tds}${actions}</tr>`;
    }).join("");

    const none = state.route.col && !rest.length
      ? `<div class="state"><strong>Ninguna columna de este libro contiene “${esc(state.route.col)}”</strong><span class="muted">Se muestran solo las columnas de identificación.</span></div>` : "";
    $("content").innerHTML = `${none}<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  // Ficha: un municipio leído de arriba abajo, agrupado por los encabezados de la matriz.
  function renderFichas(data, rows, admin) {
    const id = idCols(data.columns);
    const skip = new Set([id.n, id.dane, id.dep, id.mun, id.acuerdo, id.anio]);
    const fields = data.columns.map((name, i) => ({ name, i })).filter(({ name, i }) => !skip.has(i) && (!state.route.col || matchesColumn(name)));
    const edits = entry().edits;

    const html = rows.map(({ row, i }) => {
      const changed = edits.get(row);
      const groups = [];
      fields.forEach(({ name, i: c }) => {
        const { grp, sub } = splitName(name);
        let g = groups[groups.length - 1];
        if (!g || g.grp !== grp) groups.push((g = { grp, items: [] }));
        g.items.push({ sub, c });
      });
      const body = groups.map((g) => {
        const filled = g.items.filter(({ c }) => (row[c] ?? "") !== "").length;
        const dl = g.items.map(({ sub, c }) => {
          const v = row[c] ?? "";
          const val = v === "" ? `<span class="dash">—</span>` : norm(v) === "no" || isNA(v) ? `<span class="no">${esc(v)}</span>` : esc(v);
          return `<dt>${highlight(sub, state.route.col)}</dt><dd${changed && changed.has(c) ? ' class="edited"' : ""}>${val}</dd>`;
        }).join("");
        return `<section class="group"><h3>${highlight(g.grp || "Datos generales", state.route.col)}<span class="meta">${filled} de ${plural(g.items.length, "campo", "campos")} con dato</span></h3><dl class="kv">${dl}</dl></section>`;
      }).join("");

      const facts = [
        id.dep >= 0 ? `<span>Departamento <b>${esc(row[id.dep])}</b></span>` : "",
        id.dane >= 0 ? `<span>Código DANE <b class="id-col">${esc(row[id.dane] || "—")}</b></span>` : "",
        id.anio >= 0 ? `<span>Actualización <b class="num">${esc(row[id.anio] || "—")}</b></span>` : "",
      ].join("");
      const acuerdo = id.acuerdo >= 0 && row[id.acuerdo] ? `<p class="meta" style="margin-top:8px;white-space:pre-line">${esc(row[id.acuerdo])}</p>` : "";
      const actions = admin ? `<div class="title-actions"><button class="btn" type="button" data-edit="${i}">Editar</button><button class="btn" type="button" data-delete="${i}">Eliminar</button></div>` : "";
      const empty = !fields.length ? `<div class="state"><strong>Ninguna columna contiene “${esc(state.route.col)}”</strong></div>` : "";
      return `<article class="ficha"><div class="ficha-head"><div><h2>${esc(row[id.mun])}</h2><div class="ficha-facts">${facts}</div>${acuerdo}</div>${actions}</div>${empty}${body}</article>`;
    }).join("");
    $("content").innerHTML = `<div class="ficha-wrap">${html}</div>`;
  }

  // ---------- Edición ----------
  let editing = null; // { row (array) | null para nuevo, values: [] }

  function openEditor(rowIndex) {
    const { data } = entry();
    const id = idCols(data.columns);
    const isNew = rowIndex == null;
    const row = isNew ? null : data.rows[rowIndex];
    const values = isNew ? data.columns.map(() => "") : row.slice();
    if (isNew) {
      if (id.n >= 0) values[id.n] = String(data.rows.reduce((m, r) => Math.max(m, parseInt(r[id.n], 10) || 0), 0) + 1);
      if (id.dep >= 0 && state.route.dep) values[id.dep] = state.route.dep;
    }
    editing = { row, values, original: values.slice() };

    $("editTitle").textContent = isNew ? "Nuevo registro" : `Editar ${row[id.mun] || "registro"}`;
    $("editSub").textContent = `${sheetBySlug(state.route.slug).name}${isNew ? "" : ` · ${row[id.dep] || ""}`}`;
    $("fieldFilter").value = state.route.col;

    let html = "";
    let lastGrp = null;
    data.columns.forEach((name, c) => {
      const { grp, sub } = splitName(name);
      if (grp !== lastGrp) {
        html += `<p class="grp-title" data-grp="${esc(grp)}">${esc(grp || "Identificación del acuerdo")}</p>`;
        lastGrp = grp;
      }
      const v = values[c] ?? "";
      const long = v.length > 70 || v.includes("\n") || /definici|descripci|observaci|requisito|condici/i.test(name);
      const required = c === id.dep || c === id.mun ? " required" : "";
      const ctrl = long
        ? `<textarea data-col="${c}" rows="${Math.min(8, Math.max(3, Math.ceil(v.length / 70)))}"${required}>${esc(v)}</textarea>`
        : `<input data-col="${c}" value="${esc(v)}"${required}${c === id.dane || c === id.n ? ' inputmode="numeric"' : ""}>`;
      html += `<label class="ef" data-name="${esc(norm(name))}" data-grp-of="${esc(grp)}"><span>${esc(sub)}</span>${ctrl}</label>`;
    });
    $("editFields").innerHTML = html;
    filterFields();
    updateChanged();
    $("editDialog").showModal();
    const first = $("editFields").querySelector(".ef:not([hidden]) input, .ef:not([hidden]) textarea");
    if (first) first.focus();
  }

  function filterFields() {
    const words = norm($("fieldFilter").value).split(/\s+/).filter(Boolean);
    let shown = 0;
    const labels = $("editFields").querySelectorAll(".ef");
    labels.forEach((el) => {
      const hit = words.every((w) => el.dataset.name.includes(w));
      el.hidden = !hit;
      if (hit) shown++;
    });
    $("editFields").querySelectorAll(".grp-title").forEach((t) => {
      t.hidden = ![...labels].some((el) => !el.hidden && el.dataset.grpOf === t.dataset.grp);
    });
    $("fieldCount").textContent = `${shown} de ${labels.length} campos`;
    let none = $("editFields").querySelector(".state");
    if (!shown) {
      if (!none) {
        none = document.createElement("div");
        none.className = "state";
        $("editFields").prepend(none);
      }
      none.innerHTML = `<strong>Ningún campo contiene “${esc($("fieldFilter").value)}”</strong><span class="muted">Borra la búsqueda para ver los ${labels.length} campos.</span>`;
    } else if (none) none.remove();
  }

  function updateChanged() {
    const n = [...$("editFields").querySelectorAll("[data-col]")].filter((el) => {
      const c = Number(el.dataset.col);
      const changed = el.value.trim() !== (editing.original[c] ?? "");
      el.closest(".ef").classList.toggle("changed", changed);
      return changed;
    }).length;
    $("editChanged").textContent = n ? plural(n, "campo modificado", "campos modificados") : "Sin cambios";
  }

  function applyEdit() {
    const e = entry();
    const { data } = e;
    const id = idCols(data.columns);
    const inputs = [...$("editFields").querySelectorAll("[data-col]")];
    const values = editing.values.slice();
    const changedCols = new Set();
    inputs.forEach((el) => {
      const c = Number(el.dataset.col);
      const v = el.value.replace(/\r\n?/g, "\n").trim();
      if (v !== (editing.original[c] ?? "")) changedCols.add(c);
      values[c] = v;
    });
    if ((id.dep >= 0 && !values[id.dep]) || (id.mun >= 0 && !values[id.mun])) {
      toast("Departamento y Municipio son obligatorios.", "error");
      const missing = inputs.find((el) => (Number(el.dataset.col) === id.dep || Number(el.dataset.col) === id.mun) && !el.value.trim());
      if (missing) { missing.closest(".ef").hidden = false; missing.focus(); }
      return;
    }
    if (!changedCols.size && editing.row) { $("editDialog").close(); return; }

    let row = editing.row;
    if (row) {
      values.forEach((v, c) => { row[c] = v; });
    } else {
      row = values;
      data.rows.push(row);
      data.columns.forEach((_, c) => { if (values[c] !== "") changedCols.add(c); });
    }
    const marks = e.edits.get(row) || new Set();
    changedCols.forEach((c) => marks.add(c));
    e.edits.set(row, marks);
    e.dirty = true;
    $("editDialog").close();
    toast(`${row[id.mun]}: ${plural(changedCols.size, "campo actualizado", "campos actualizados")}. Falta guardar en GitHub.`);
    render();
  }

  function deleteRow(i) {
    const e = entry();
    const id = idCols(e.data.columns);
    const row = e.data.rows[i];
    if (!confirm(`¿Eliminar el registro de ${row[id.mun]} (${row[id.dep]}) de ${sheetBySlug(state.route.slug).name}? El cambio se aplica al guardar en GitHub.`)) return;
    e.data.rows.splice(i, 1);
    e.dirty = true;
    if (state.route.mun === row[id.mun] && !filteredRows(e.data).length) state.route.mun = "";
    go({});
  }

  // ---------- Carga de CSV ----------
  async function handleFile(file) {
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      toast(`“${file.name}” no es un CSV. En Excel: Archivo › Guardar como › CSV UTF-8.`, "error");
      return;
    }
    let table;
    try {
      table = await window.CSVTools.readFile(file);
    } catch (err) {
      toast(`No se pudo leer el CSV: ${err.message}`, "error");
      return;
    }
    if (!table.rows.length) {
      toast("El CSV no tiene registros reconocibles (filas con Departamento y Municipio).", "error");
      return;
    }
    const e = entry();
    const data = e.data;
    const mode = document.querySelector('input[name="mode"]:checked').value;
    if (mode === "append" && data.rows.length) {
      const columns = data.columns.slice();
      table.columns.forEach((c) => { if (!columns.includes(c)) columns.push(c); });
      const mapIdx = columns.map((c) => table.columns.indexOf(c));
      data.rows = data.rows.map((r) => columns.map((_, i) => r[i] ?? ""));
      const added = table.rows.map((r) => mapIdx.map((j) => (j >= 0 ? r[j] ?? "" : "")));
      added.forEach((r) => e.edits.set(r, new Set(columns.map((_, i) => i).filter((i) => r[i] !== ""))));
      data.columns = columns;
      data.rows = data.rows.concat(added);
      toast(`${plural(added.length, "registro agregado", "registros agregados")} (${data.rows.length} en total). Falta guardar en GitHub.`);
    } else {
      data.columns = table.columns;
      data.rows = table.rows;
      e.edits = new WeakMap();
      toast(`${plural(table.rows.length, "registro", "registros")} y ${plural(table.columns.length, "columna", "columnas")} leídos. Falta guardar en GitHub.`);
    }
    data.sourceFile = file.name;
    e.dirty = true;
    go({ dep: "", mun: "" });
  }

  // ---------- Guardar ----------
  async function save() {
    if (!GH.hasToken()) { openSettings(); return; }
    const sheet = sheetBySlug(state.route.slug);
    const e = entry();
    const btn = $("saveBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }
    try {
      if (!e.sha) e.sha = (await GH.getFile(sheet.slug)).sha;
      const data = { ...e.data, sheet: sheet.name, updatedAt: new Date().toISOString() };
      e.sha = await GH.putFile(sheet.slug, data, e.sha, `Actualiza ${sheet.name} (${data.rows.length} registros)`);
      e.data = data;
      e.saved = clone(data);
      e.dirty = false;
      e.edits = new WeakMap();
      await updateIndex(sheet, data);
      toast(`${sheet.name} guardado en GitHub.`);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      render();
    }
  }

  // El índice lo pueden tocar dos equipos a la vez: se reintenta con el sha más reciente.
  async function updateIndex(sheet, data) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const idx = await GH.getFile("index");
        const index = idx.data || {};
        index[sheet.slug] = { rows: data.rows.length, columns: data.columns.length, updatedAt: data.updatedAt };
        await GH.putFile("index", index, idx.sha, `Actualiza índice: ${sheet.name}`);
        return;
      } catch (err) {
        if (attempt === 2) throw err;
      }
    }
  }

  function discard() {
    const e = entry();
    e.data = clone(e.saved);
    e.dirty = false;
    e.edits = new WeakMap();
    go({});
  }

  function download() {
    const { data } = entry();
    const rows = filteredRows(data).map(({ row }) => row);
    const blob = new Blob([window.CSVTools.toCSV(data.columns, rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const suffix = [state.route.dep, state.route.mun].filter(Boolean).join("-");
    a.download = `${state.route.slug}${suffix ? `-${norm(suffix).replace(/[^a-z0-9]+/g, "-")}` : ""}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Token ----------
  function openSettings() {
    $("tokenInput").value = GH.token.get();
    $("settingsMsg").textContent = "";
    $("settingsMsg").className = "meta";
    $("settingsDialog").showModal();
  }

  async function verifyToken() {
    const value = $("tokenInput").value.trim();
    const msg = $("settingsMsg");
    if (!value) { msg.textContent = "Pega el token."; msg.className = "meta msg-error"; return; }
    const previous = GH.token.get();
    GH.token.set(value);
    msg.textContent = "Verificando…";
    msg.className = "meta";
    try {
      await GH.checkAccess();
      msg.textContent = "Token válido con permiso de escritura.";
      msg.className = "meta msg-ok";
      reloadClean();
      setTimeout(() => $("settingsDialog").close(), 700);
    } catch (err) {
      GH.token.set(previous);
      msg.textContent = err.message;
      msg.className = "meta msg-error";
    }
  }

  function reloadClean() {
    Object.keys(state.cache).forEach((slug) => { if (!state.cache[slug].dirty) delete state.cache[slug]; });
    openBook();
  }

  // ---------- Menú lateral en pantallas angostas ----------
  function setMenu(open) {
    $("sidebar").classList.toggle("open", open);
    $("scrim").hidden = !open;
    $("menuBtn").setAttribute("aria-expanded", String(open));
  }

  // ---------- Eventos ----------
  function bind() {
    window.addEventListener("hashchange", () => {
      const r = parseHash();
      const slugChanged = r.slug !== state.route.slug;
      state.route = r;
      if (slugChanged) openBook(); else render();
    });
    window.addEventListener("beforeunload", (ev) => {
      if (Object.values(state.cache).some((c) => c.dirty)) { ev.preventDefault(); ev.returnValue = ""; }
    });

    $("bookNav").addEventListener("click", (ev) => {
      const a = ev.target.closest("a[data-slug]");
      if (!a || ev.ctrlKey || ev.metaKey) return;
      ev.preventDefault();
      setMenu(false);
      go({ slug: a.dataset.slug }, { push: true });
    });
    document.querySelectorAll(".mode-tab").forEach((a) => a.addEventListener("click", (ev) => {
      if (ev.ctrlKey || ev.metaKey) return;
      ev.preventDefault();
      go({ mode: a.dataset.mode }, { push: true });
    }));

    $("depSelect").addEventListener("change", (ev) => go({ dep: ev.target.value, mun: "" }));
    $("munSelect").addEventListener("change", (ev) => {
      const mun = ev.target.value;
      const patch = { mun };
      if (mun && !state.route.dep) {
        const { data } = entry();
        const id = idCols(data.columns);
        const row = data.rows.find((r) => r[id.mun] === mun);
        if (row) patch.dep = row[id.dep];
      }
      go(patch);
    });
    let t;
    $("colInput").addEventListener("input", (ev) => {
      clearTimeout(t);
      t = setTimeout(() => go({ col: ev.target.value.trim() }), 180);
    });
    $("clearFilters").addEventListener("click", () => go({ dep: "", mun: "", col: "" }));
    $("filterSummary").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-unset]");
      if (b) go({ [b.dataset.unset]: "" });
    });

    $("main").addEventListener("click", (ev) => {
      const act = ev.target.closest("[data-act]");
      if (act) {
        const a = act.dataset.act;
        if (a === "save") save();
        else if (a === "discard") discard();
        else if (a === "download") download();
        else if (a === "new") openEditor(null);
        else if (a === "clear") go({ dep: "", mun: "", col: "" });
        else if (a === "filters") { setMenu(true); $("depSelect").focus(); }
        else if (a === "retry") { delete state.cache[state.route.slug]; openBook(); }
        return;
      }
      const edit = ev.target.closest("[data-edit]");
      if (edit) { openEditor(Number(edit.dataset.edit)); return; }
      const del = ev.target.closest("[data-delete]");
      if (del) { deleteRow(Number(del.dataset.delete)); return; }
      const cell = ev.target.closest(".cell.long");
      if (cell) cell.classList.toggle("open");
    });

    const dz = $("dropzone");
    $("fileInput").addEventListener("change", (ev) => { handleFile(ev.target.files[0]); ev.target.value = ""; });
    dz.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); $("fileInput").click(); } });
    ["dragenter", "dragover"].forEach((type) => dz.addEventListener(type, (ev) => { ev.preventDefault(); dz.classList.add("over"); }));
    ["dragleave", "drop"].forEach((type) => dz.addEventListener(type, (ev) => { ev.preventDefault(); dz.classList.remove("over"); }));
    dz.addEventListener("drop", (ev) => handleFile(ev.dataTransfer.files[0]));

    $("fieldFilter").addEventListener("input", filterFields);
    $("editFields").addEventListener("input", updateChanged);
    $("applyEdit").addEventListener("click", applyEdit);

    $("connectBtn").addEventListener("click", openSettings);
    $("verifyTokenBtn").addEventListener("click", verifyToken);
    $("removeTokenBtn").addEventListener("click", () => {
      GH.token.set("");
      $("tokenInput").value = "";
      $("settingsMsg").textContent = "Token eliminado de este navegador.";
      reloadClean();
    });
    const link = $("repoLink");
    link.href = GH.repoUrl;
    link.textContent = GH.repoUrl.replace("https://", "");

    $("menuBtn").addEventListener("click", () => setMenu(true));
    $("closeMenuBtn").addEventListener("click", () => setMenu(false));
    $("scrim").addEventListener("click", () => setMenu(false));
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") setMenu(false); });
  }

  function init() {
    bind();
    state.route = parseHash();
    history.replaceState(null, "", buildHash(state.route));
    openBook();
  }

  init();
})();
