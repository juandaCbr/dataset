# Dataset ICA Colombia

Panel de administración (HTML, CSS y JavaScript sin dependencias) para cargar las 13 pestañas de la matriz del Impuesto de Industria y Comercio desde archivos CSV exportados de Excel.

## Cómo se guardan los datos

No hay servidor ni base de datos aparte: **el repositorio de GitHub es la base de datos**.

- Cada pestaña se guarda como `data/<pestaña>.json`:
  ```json
  { "sheet": "Tarifas", "updatedAt": "2026-11-12T…", "sourceFile": "Tarifas.csv",
    "columns": ["N°", "Código Dane", "Departamento", "Municipio", …],
    "rows": [["1", "5002", "Antioquia", "Abejorral", …], …] }
  ```
- `data/index.json` guarda el número de registros por pestaña (los contadores del menú).
- **Lectura:** cualquiera que abra el sitio (GitHub Pages) lee esos JSON.
- **Escritura:** el administrador conecta un token personal de GitHub; al pulsar *Guardar en GitHub* la app hace un commit con la API de contenidos. Cada guardado queda en el historial del repositorio, así que cualquier versión anterior se puede recuperar.

## Consulta

La barra lateral lista los 13 libros y tiene tres campos de búsqueda que se mantienen al cambiar de libro:

- **Departamento** y **Municipio** (menús desplegables): filtran los registros. Con un municipio elegido, el libro se muestra como una ficha agrupada por los encabezados de la matriz.
- **Nombre de la columna** (texto): deja solo las columnas cuyo nombre contiene esas palabras, sin importar tildes ni mayúsculas.

La búsqueda queda en la URL (`#tarifas?dep=Antioquia&mun=Abejorral&col=agricultura`), así que se puede compartir el enlace.

## Administración

Se entra con la pestaña **Administración** de la barra superior.

1. En Excel, abrir la hoja y usar *Archivo › Guardar como › CSV UTF-8* (también sirve *CSV delimitado por comas*).
2. Elegir el libro y arrastrar el CSV. Solo se aceptan `.csv`. *Reemplazar registros* sustituye el libro completo; *Agregar a los existentes* une por nombre de columna.
3. **Editar** (lápiz en la fila, o botón en la ficha) abre un panel con todos los campos del registro y un buscador de campos. Los campos cambiados quedan marcados con un punto hasta guardar.
4. **Nuevo registro** y **Eliminar** también están disponibles.
5. Nada se publica hasta pulsar **Guardar en GitHub**; **Descartar** vuelve a la última versión guardada.

## Publicar y conectar

1. GitHub › Settings › Pages › *Deploy from a branch* › `main` / `(root)`.
2. Crear un token *fine-grained* en <https://github.com/settings/personal-access-tokens/new>: acceso solo al repositorio `dataset`, permiso **Contents: Read and write**.
3. En la app: *Conexión GitHub* › pegar el token › *Verificar y guardar*. El token queda solo en ese navegador.

## Ejecutar en local

```bash
python -m http.server 5173
```

y abrir <http://localhost:5173>. (Abrir `index.html` con doble clic no funciona: el navegador bloquea la lectura de `data/*.json` desde `file://`.)
