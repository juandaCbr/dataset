// Configuración general del dataset.
// Los datos de cada pestaña se guardan como data/<slug>.json en el repositorio de GitHub.
window.APP_CONFIG = {
  github: {
    owner: "juandaCbr",
    repo: "dataset",
    branch: "main",
    dataDir: "data",
  },
  sheets: [
    { slug: "principios", name: "Principios", desc: "Principios tributarios aplicados al ICA en cada acuerdo municipal." },
    { slug: "elementos_tributo", name: "Elementos del Tributo", desc: "Sujeto activo, sujeto pasivo, hecho generador, periodo gravable y causación." },
    { slug: "actividades_no_sujetas", name: "Actividades No Sujetas", desc: "Actividades no sujetas al impuesto y contribuyentes que las realizan." },
    { slug: "deducciones_exclusiones", name: "Deducciones y Exclusiones", desc: "Deducciones de la base gravable y requisitos para la exclusión." },
    { slug: "exenciones_incentivos", name: "Exenciones e Incentivos", desc: "Incentivos por creación de empleo, zonas francas y exenciones temporales." },
    { slug: "tarifas", name: "Tarifas", desc: "Tarifas mínimas y máximas por actividad económica." },
    { slug: "economia_digital", name: "Economía Digital", desc: "Hechos generadores de la economía digital y plataformas." },
    { slug: "territorialidad", name: "Territorialidad", desc: "Reglas de territorialidad del ingreso por municipio." },
    { slug: "sector_financiero", name: "S. Financiero", desc: "Entidades del sector financiero y bases gravables especiales." },
    { slug: "rst", name: "RST", desc: "Régimen Simple de Tributación: tarifas, inclusión y exclusión." },
    { slug: "regimen_preferencial", name: "Régimen Preferencial", desc: "Condiciones, tarifas y actividades del régimen preferencial." },
    { slug: "avisos_tableros", name: "Avisos y Tableros", desc: "Impuesto complementario de avisos y tableros." },
    { slug: "sobretasa_bomberil", name: "Sobretasa Bomberil", desc: "Sobretasa bomberil: sujetos, hecho generador, base y tarifa." },
  ],
};
