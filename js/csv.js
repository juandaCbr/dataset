// Lectura de CSV exportados desde Excel y extracción de la tabla de la matriz.
(function () {
  "use strict";

  // Excel guarda "CSV UTF-8" con BOM, y "CSV (delimitado por comas)" en Windows-1252.
  function decodeBuffer(buffer) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^﻿/, "");
    } catch (_) {
      return new TextDecoder("windows-1252").decode(buffer);
    }
  }

  // En configuración regional de Colombia/España Excel separa con ";".
  function detectDelimiter(text) {
    const sample = text.slice(0, 20000);
    const counts = { ";": 0, ",": 0, "\t": 0 };
    let inQuotes = false;
    for (const ch of sample) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && ch in counts) counts[ch]++;
    }
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  }

  // Parser RFC 4180: campos entre comillas, comillas dobles escapadas y saltos de línea dentro del campo.
  function parseCSV(text, delimiter) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        row.push(field); field = "";
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row);
        row = []; field = "";
      } else field += ch;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const clean = (s) => String(s || "").replace(/\r\n?/g, "\n").trim();
  const label = (s) => clean(s).replace(/\s+/g, " ");

  // Convierte las filas crudas del CSV en { columns, rows }.
  // La matriz trae títulos en las primeras filas, una fila de grupos (celdas combinadas)
  // y la fila de encabezados que empieza con "Código Dane".
  function extractTable(raw) {
    const width = raw.reduce((m, r) => Math.max(m, r.length), 0);
    const cell = (r, c) => clean((raw[r] || [])[c]);
    const headerIdx = raw.findIndex((r) => r.some((c) => norm(c).includes("codigo dane")));

    if (headerIdx === -1) {
      // CSV plano: primera fila no vacía como encabezado.
      const start = raw.findIndex((r) => r.some((c) => clean(c)));
      if (start === -1) return { columns: [], rows: [] };
      const header = raw[start].map((h, i) => label(h) || `Columna ${i + 1}`);
      const rows = raw.slice(start + 1)
        .filter((r) => r.some((c) => clean(c)))
        .map((r) => header.map((_, i) => clean(r[i])));
      return { columns: dedupe(header), rows };
    }

    const sub = Array.from({ length: width }, (_, c) => label(cell(headerIdx, c)));
    const grp = Array.from({ length: width }, (_, c) => (headerIdx > 0 ? label(cell(headerIdx - 1, c)) : ""));

    // Filas de datos: N° entero y Departamento + Municipio diligenciados.
    const findCol = (name, fallback) => {
      const i = sub.findIndex((h) => norm(h) === name);
      return i === -1 ? fallback : i;
    };
    const depCol = findCol("departamento", 2);
    const munCol = findCol("municipio", 3);
    const dataRows = raw.slice(headerIdx + 1).filter((r) =>
      // Las filas de plantilla sin diligenciar traen "0" desde fórmulas: se exige texto.
      /^\d+$/.test(clean(r[0])) && /\p{L}/u.test(clean(r[depCol])) && /\p{L}/u.test(clean(r[munCol])) &&
      norm(r[depCol]) !== "departamento" // fila de encabezado repetida

    );

    // Nombres de columna combinando grupo (relleno hacia la derecha) y subencabezado.
    const names = [];
    const keep = [];
    let groupFill = "";
    const subFilled = sub.slice();
    const inverted = new Array(width).fill(false);
    for (let c = 0; c < width; c++) {
      if (grp[c]) groupFill = grp[c];
      // Caso Tarifas: la actividad ocupa 2 columnas (fila inferior) y arriba van Mínimo / Máximo.
      if (!sub[c] && c > 0 && grp[c] && grp[c - 1] && grp[c] !== grp[c - 1] && subFilled[c - 1]) {
        subFilled[c] = subFilled[c - 1];
        inverted[c] = inverted[c - 1] = true;
      }
      const hasData = dataRows.some((r) => clean(r[c]));
      if (!sub[c] && !grp[c] && !hasData) continue;

      let name;
      const g = norm(groupFill).startsWith("identificacion del acuerdo") ? "" : groupFill;
      const s = subFilled[c];
      if (c === 0 && !s && !grp[c]) name = "N°";
      else if (!g) name = s || `Columna ${c + 1}`;
      else if (!s) name = g;
      else if (norm(g) === norm(s)) name = s;
      else name = inverted[c] ? `${s} — ${g}` : `${g} — ${s}`;
      names.push(name);
      keep.push(c);
    }
    // Revisión de la primera columna invertida (se marca después de procesarla).
    for (let k = 0; k < keep.length; k++) {
      const c = keep[k];
      if (inverted[c] && grp[c] && subFilled[c] && !names[k].startsWith(subFilled[c])) {
        names[k] = `${subFilled[c]} — ${grp[c]}`;
      }
    }

    return {
      columns: dedupe(names),
      rows: dataRows.map((r) => keep.map((c) => clean(r[c]))),
    };
  }

  function dedupe(names) {
    const seen = new Map();
    return names.map((n) => {
      const count = (seen.get(n) || 0) + 1;
      seen.set(n, count);
      return count === 1 ? n : `${n} (${count})`;
    });
  }

  async function readFile(file) {
    const text = decodeBuffer(await file.arrayBuffer());
    const delimiter = detectDelimiter(text);
    return extractTable(parseCSV(text, delimiter));
  }

  // Exporta con ";" y BOM para que Excel en español lo abra correctamente.
  function toCSV(columns, rows) {
    const esc = (v) => {
      const s = String(v ?? "");
      return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return "﻿" + [columns, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
  }

  window.CSVTools = { decodeBuffer, detectDelimiter, parseCSV, extractTable, readFile, toCSV };
})();
