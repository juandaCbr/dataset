// Vista de administrador: carga de CSV por pestaña, tabla de registros y guardado en GitHub.
(function () {
  "use strict";

  const { sheets } = window.APP_CONFIG;
  const GH = window.GitHubStore;
  const $ = (id) => document.getElementById(id);

  const state = {
    current: null,
    index: {},          // { slug: { rows, updatedAt } }
    cache: {},          // slug -> { data, sha, saved, dirty }
    filter: "",
  };

  const emptyData = (sheet) => ({ sheet: sheet.name, updatedAt: null, sourceFile: null, columns: [], rows: [] });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const fmtDate = (iso) => iso ? new Date(iso).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "";

  function toast(msg, type = "") {
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = msg;
    $("toasts").appendChild(el);
    setTimeout(() => el.remove(), type === "error" ? 8000 : 4000);
  }

  // ---------- Datos ----------
  async function loadIndex() {
    try {
      state.index = (GH.hasToken() ? (await GH.getFile("index")).data : await GH.getPublic("index")) || {};
    } catch (e) {
      state.index = {};
      console.warn(e);
    }
    renderNav();
  }

  async function loadSheet(sheet, force = false) {
    if (state.cache[sheet.slug] && !force) return state.cache[sheet.slug];
    let data = null;
    let sha = null;
    if (GH.hasToken()) {
      ({ data, sha } = await GH.getFile(sheet.slug));
    } else {
      data = await GH.getPublic(sheet.slug);
    }
    data = data || emptyData(sheet);
    const entry = { data, sha, saved: clone(data), dirty: false };
    state.cache[sheet.slug] = entry;
    return entry;
  }

  // ---------- Navegación ----------
  function renderNav() {
    $("sheetCountLabel").textContent = `Gestión de ${sheets.length} pestañas`;
    $("sheetNav").innerHTML = sheets.map((s) => {
      const entry = state.cache[s.slug];
      const n = entry ? entry.data.rows.length : (state.index[s.slug]?.rows ?? 0);
      const dirty = entry?.dirty ? " dirty" : "";
      const active = state.current?.slug === s.slug ? " active" : "";
      return `<a href="#${s.slug}" class="${active.trim()}"${active ? ' aria-current="page"' : ""}>
        <span>${esc(s.name)}</span><span class="badge${dirty}">${n}</span></a>`;
    }).join("");
  }

  async function selectSheet(slug) {
    const sheet = sheets.find((s) => s.slug === slug) || sheets[0];
    state.current = sheet;
    state.filter = "";
    $("filterInput").value = "";
    $("viewTag").textContent = sheet.slug;
    $("viewTitle").textContent = sheet.name;
    $("viewDesc").textContent = sheet.desc;
    document.title = `${sheet.name} · Dataset ICA Colombia`;
    document.querySelector(".sidebar").classList.remove("open");
    $("menuToggle").setAttribute("aria-expanded", "false");
    renderNav();
    $("tableWrap").innerHTML = `<div class="empty-state">Cargando registros…</div>`;
    try {
      await loadSheet(sheet);
    } catch (e) {
      state.cache[sheet.slug] = { data: emptyData(sheet), sha: null, saved: emptyData(sheet), dirty: false, error: true };
      toast(e.message, "error");
    }
    if (state.current === sheet) renderView();
  }

  // ---------- Vista ----------
  function renderView() {
    const entry = state.cache[state.current.slug];
    const { data } = entry;
    $("lastUpdate").innerHTML = data.updatedAt
      ? `Actualizado: ${esc(fmtDate(data.updatedAt))}${data.sourceFile ? `<br>Archivo: ${esc(data.sourceFile)}` : ""}`
      : "";
    $("pendingBar").hidden = !entry.dirty;
    $("pendingText").textContent = GH.hasToken()
      ? "Hay cambios sin guardar en esta pestaña."
      : "Hay cambios sin guardar. Conecta tu token de GitHub para guardarlos.";
    renderNav();
    renderTable();
  }

  function renderTable() {
    const { data } = state.cache[state.current.slug];
    const q = state.filter.trim().toLowerCase();
    const rows = data.rows.map((r, i) => [r, i]).filter(([r]) => !q || r.some((v) => String(v).toLowerCase().includes(q)));

    $("recordCount").textContent = q ? `(${rows.length} de ${data.rows.length})` : `(${data.rows.length})`;
    $("columnInfo").textContent = data.columns.length ? `${data.columns.length} columnas · desplázate horizontalmente para verlas todas · clic en una celda para ver el texto completo` : "";

    if (!data.rows.length) {
      $("tableWrap").innerHTML = `<div class="empty-state"><strong>Aún no hay registros en esta pestaña</strong>Sube el CSV exportado desde la hoja “${esc(state.current.name)}” del Excel.</div>`;
      return;
    }
    if (!rows.length) {
      $("tableWrap").innerHTML = `<div class="empty-state"><strong>Sin resultados</strong>Ningún registro coincide con “${esc(state.filter)}”.</div>`;
      return;
    }

    // Columnas fijas a la izquierda: desde la primera hasta Municipio.
    const munIdx = data.columns.findIndex((c) => c.toLowerCase() === "municipio");
    const stickyCount = munIdx >= 0 && munIdx <= 4 ? munIdx + 1 : 0;
    const widths = data.columns.slice(0, stickyCount).map((c, i) => (i === 0 ? 64 : /dane/i.test(c) ? 100 : 140));
    const lefts = widths.map((_, i) => widths.slice(0, i).reduce((a, b) => a + b, 0));
    const stickyAttr = (i) => i < stickyCount
      ? ` class="sticky${i === stickyCount - 1 ? " sticky-last" : ""}" style="left:${lefts[i]}px;min-width:${widths[i]}px;max-width:${widths[i]}px"`
      : "";

    const head = `<tr>${data.columns.map((c, i) => `<th${stickyAttr(i)} title="${esc(c)}"><div class="th-text">${esc(c)}</div></th>`).join("")}<th class="col-actions">Acciones</th></tr>`;
    const body = rows.map(([r, idx]) => `<tr>${data.columns.map((_, i) => {
      const v = r[i] ?? "";
      const cls = v === "" ? "cell empty" : /^-?[\d.,%]+$/.test(v) ? "cell num" : "cell";
      return `<td${stickyAttr(i)}><div class="${cls}">${v === "" ? "—" : esc(v)}</div></td>`;
    }).join("")}<td class="col-actions"><button class="icon-btn" data-delete="${idx}" title="Eliminar registro" aria-label="Eliminar registro ${idx + 1}">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
    </button></td></tr>`).join("");

    $("tableWrap").innerHTML = `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  // ---------- Carga de CSV ----------
  async function handleFile(file) {
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      toast(`“${file.name}” no es un CSV. En Excel usa Archivo › Guardar como › CSV UTF-8.`, "error");
      return;
    }
    let table;
    try {
      table = await window.CSVTools.readFile(file);
    } catch (e) {
      toast(`No se pudo leer el CSV: ${e.message}`, "error");
      return;
    }
    if (!table.rows.length) {
      toast("El CSV no tiene registros reconocibles (filas con N°, Departamento y Municipio).", "error");
      return;
    }

    const entry = state.cache[state.current.slug];
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const data = entry.data;

    if (mode === "append" && data.rows.length) {
      // Une por nombre de columna; las columnas nuevas se agregan al final.
      const columns = data.columns.slice();
      table.columns.forEach((c) => { if (!columns.includes(c)) columns.push(c); });
      const pad = (r) => columns.map((_, i) => r[i] ?? "");
      const existing = data.rows.map(pad);
      const mapIdx = columns.map((c) => table.columns.indexOf(c));
      const added = table.rows.map((r) => mapIdx.map((j) => (j >= 0 ? r[j] ?? "" : "")));
      data.columns = columns;
      data.rows = existing.concat(added);
      toast(`${added.length} registros agregados (${data.rows.length} en total). Falta guardar en GitHub.`);
    } else {
      data.columns = table.columns;
      data.rows = table.rows;
      toast(`${table.rows.length} registros y ${table.columns.length} columnas leídos. Falta guardar en GitHub.`);
    }
    data.sourceFile = file.name;
    entry.dirty = true;
    renderView();
  }

  // ---------- Guardar ----------
  async function save() {
    if (!GH.hasToken()) {
      openSettings();
      return;
    }
    const sheet = state.current;
    const entry = state.cache[sheet.slug];
    const btn = $("saveBtn");
    btn.disabled = true;
    btn.textContent = "Guardando…";
    try {
      if (!entry.sha) {
        // Los datos se leyeron sin token: se obtiene el sha actual del archivo.
        entry.sha = (await GH.getFile(sheet.slug)).sha;
      }
      const data = { ...entry.data, sheet: sheet.name, updatedAt: new Date().toISOString() };
      entry.sha = await GH.putFile(sheet.slug, data, entry.sha, `Actualiza ${sheet.name} (${data.rows.length} registros)`);
      entry.data = data;
      entry.saved = clone(data);
      entry.dirty = false;

      const idx = await GH.getFile("index");
      const index = idx.data || {};
      index[sheet.slug] = { rows: data.rows.length, columns: data.columns.length, updatedAt: data.updatedAt };
      await GH.putFile("index", index, idx.sha, `Actualiza índice: ${sheet.name}`);
      state.index = index;
      toast(`“${sheet.name}” guardado en GitHub.`, "ok");
    } catch (e) {
      toast(e.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Guardar en GitHub";
      if (state.current === sheet) renderView();
    }
  }

  function discard() {
    const entry = state.cache[state.current.slug];
    entry.data = clone(entry.saved);
    entry.dirty = false;
    renderView();
  }

  function deleteRow(idx) {
    const entry = state.cache[state.current.slug];
    const row = entry.data.rows[idx];
    const munIdx = entry.data.columns.findIndex((c) => c.toLowerCase() === "municipio");
    const label = munIdx >= 0 ? row[munIdx] : `#${idx + 1}`;
    if (!confirm(`¿Eliminar el registro de ${label}? El cambio se aplica al guardar en GitHub.`)) return;
    entry.data.rows.splice(idx, 1);
    entry.dirty = true;
    renderView();
  }

  function download() {
    const { data } = state.cache[state.current.slug];
    if (!data.rows.length) { toast("No hay registros para descargar."); return; }
    const blob = new Blob([window.CSVTools.toCSV(data.columns, data.rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${state.current.slug}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Token ----------
  function updateModeChip() {
    const admin = GH.hasToken();
    $("modeChip").textContent = admin ? "Admin conectado" : "Modo lectura";
    $("modeChip").className = `chip ${admin ? "chip-admin" : "chip-readonly"}`;
  }

  function openSettings() {
    $("tokenInput").value = GH.token.get();
    $("settingsMsg").textContent = "";
    $("settingsMsg").className = "small";
    $("settingsDialog").showModal();
  }

  async function verifyToken() {
    const value = $("tokenInput").value.trim();
    const msg = $("settingsMsg");
    if (!value) { msg.textContent = "Escribe el token."; msg.className = "small msg-error"; return; }
    const previous = GH.token.get();
    GH.token.set(value);
    msg.textContent = "Verificando…";
    msg.className = "small";
    try {
      await GH.checkAccess();
      msg.textContent = "Token válido con permiso de escritura.";
      msg.className = "small msg-ok";
      updateModeChip();
      await reloadAfterTokenChange();
      setTimeout(() => $("settingsDialog").close(), 700);
    } catch (e) {
      GH.token.set(previous);
      msg.textContent = e.message;
      msg.className = "small msg-error";
    }
  }

  async function reloadAfterTokenChange() {
    // Conserva las pestañas con cambios pendientes; el resto se recarga desde GitHub.
    Object.keys(state.cache).forEach((slug) => { if (!state.cache[slug].dirty) delete state.cache[slug]; });
    await loadIndex();
    if (state.current) await selectSheet(state.current.slug);
  }

  // ---------- Eventos ----------
  function bind() {
    window.addEventListener("hashchange", () => selectSheet(location.hash.slice(1)));
    window.addEventListener("beforeunload", (e) => {
      if (Object.values(state.cache).some((c) => c.dirty)) { e.preventDefault(); e.returnValue = ""; }
    });

    const dz = $("dropzone");
    $("fileInput").addEventListener("change", (e) => { handleFile(e.target.files[0]); e.target.value = ""; });
    dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("fileInput").click(); } });
    ["dragenter", "dragover"].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add("over"); }));
    ["dragleave", "drop"].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
    dz.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));

    let t;
    $("filterInput").addEventListener("input", (e) => {
      clearTimeout(t);
      t = setTimeout(() => { state.filter = e.target.value; renderTable(); }, 150);
    });

    $("tableWrap").addEventListener("click", (e) => {
      const del = e.target.closest("[data-delete]");
      if (del) { deleteRow(Number(del.dataset.delete)); return; }
      const cell = e.target.closest(".cell");
      if (cell && !cell.classList.contains("empty")) cell.classList.toggle("expanded");
    });

    $("saveBtn").addEventListener("click", save);
    $("discardBtn").addEventListener("click", discard);
    $("downloadBtn").addEventListener("click", download);
    $("settingsBtn").addEventListener("click", openSettings);
    $("verifyTokenBtn").addEventListener("click", verifyToken);
    $("removeTokenBtn").addEventListener("click", async () => {
      GH.token.set("");
      $("tokenInput").value = "";
      $("settingsMsg").textContent = "Token eliminado de este navegador.";
      $("settingsMsg").className = "small";
      updateModeChip();
      await reloadAfterTokenChange();
    });
    $("menuToggle").addEventListener("click", () => {
      const open = document.querySelector(".sidebar").classList.toggle("open");
      $("menuToggle").setAttribute("aria-expanded", String(open));
    });

    const link = $("repoLink");
    link.href = GH.repoUrl;
    link.textContent = GH.repoUrl.replace("https://", "");
  }

  async function init() {
    bind();
    updateModeChip();
    await loadIndex();
    const slug = location.hash.slice(1);
    await selectSheet(sheets.some((s) => s.slug === slug) ? slug : sheets[0].slug);
  }

  init();
})();
