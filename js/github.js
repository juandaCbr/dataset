// Persistencia: cada pestaña es un archivo JSON dentro del repositorio de GitHub.
// Lectura pública: fetch("data/<slug>.json") (GitHub Pages o servidor local).
// Escritura: API de contenidos de GitHub con un token personal del administrador.
(function () {
  "use strict";

  const cfg = window.APP_CONFIG.github;
  const API = "https://api.github.com";
  const TOKEN_KEY = "dataset-ica.github-token";

  const store = {
    get() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (_) { return ""; } },
    set(v) { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch (_) {} },
  };

  const pathFor = (name) => `${cfg.dataDir}/${name}.json`;

  function headers(accept) {
    return {
      Accept: accept || "application/vnd.github+json",
      Authorization: `Bearer ${store.get()}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function base64ToUtf8(b64) {
    const bin = atob(b64.replace(/\n/g, ""));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  async function apiError(res, action) {
    let msg = "";
    try { msg = (await res.json()).message || ""; } catch (_) {}
    const hints = {
      401: "El token no es válido o expiró.",
      403: "El token no tiene permiso de escritura (Contents: Read and write) o se superó el límite de la API.",
      404: "No se encontró el repositorio o el token no tiene acceso a él.",
      409: "Conflicto: alguien más guardó cambios. Recarga la pestaña e inténtalo de nuevo.",
      422: "GitHub rechazó el archivo (cambios simultáneos o archivo demasiado grande). Recarga e inténtalo de nuevo.",
    };
    return new Error(`${action}: ${hints[res.status] || `HTTP ${res.status}`}${msg ? ` (${msg})` : ""}`);
  }

  // Devuelve { data, sha } o { data: null, sha: null } si el archivo aún no existe.
  async function getFile(name) {
    const url = `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${pathFor(name)}?ref=${cfg.branch}`;
    const res = await fetch(url, { headers: headers(), cache: "no-store" });
    if (res.status === 404) return { data: null, sha: null };
    if (!res.ok) throw await apiError(res, `Leyendo ${name}.json`);
    const meta = await res.json();
    let text;
    if (meta.content && meta.encoding === "base64") {
      text = base64ToUtf8(meta.content);
    } else {
      // Archivos de más de 1 MB: la API no incluye el contenido, se pide en crudo.
      const raw = await fetch(url, { headers: headers("application/vnd.github.raw+json"), cache: "no-store" });
      if (!raw.ok) throw await apiError(raw, `Leyendo ${name}.json`);
      text = await raw.text();
    }
    return { data: JSON.parse(text), sha: meta.sha };
  }

  async function putFile(name, data, sha, message) {
    const url = `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${pathFor(name)}`;
    const body = {
      message,
      content: utf8ToBase64(JSON.stringify(data, null, 1) + "\n"),
      branch: cfg.branch,
    };
    if (sha) body.sha = sha;
    const res = await fetch(url, { method: "PUT", headers: headers(), body: JSON.stringify(body) });
    if (!res.ok) throw await apiError(res, `Guardando ${name}.json`);
    return (await res.json()).content.sha;
  }

  // Lectura sin token (sitio publicado o servidor local).
  async function getPublic(name) {
    const res = await fetch(`${pathFor(name)}?t=${Date.now()}`, { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`No se pudo leer ${name}.json (HTTP ${res.status})`);
    return res.json();
  }

  async function checkAccess() {
    const res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}`, { headers: headers() });
    if (!res.ok) throw await apiError(res, "Verificando el token");
    const repo = await res.json();
    if (!repo.permissions || !repo.permissions.push) {
      throw new Error("El token puede leer el repositorio pero no escribir en él.");
    }
    return repo;
  }

  window.GitHubStore = {
    token: store,
    hasToken: () => !!store.get(),
    getFile,
    putFile,
    getPublic,
    checkAccess,
    repoUrl: `https://github.com/${cfg.owner}/${cfg.repo}`,
  };
})();
