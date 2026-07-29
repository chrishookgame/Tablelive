// start.js
//
// Por qué existe este archivo: antes, TableLive arrancaba directo con "node server.js"
// y guardaba todo (usuarios, posts, retiros, etc.) en archivos .json dentro de la misma
// carpeta del proyecto. El problema es que Render borra esa carpeta cada vez que hace un
// nuevo deploy o reinicia el servicio — así que los usuarios se perdían y todos quedaban
// desconectados.
//
// Ahora, ANTES de arrancar el servidor real (server.js), este archivo:
//   1. Se conecta a la base de datos PostgreSQL (usando la variable DATABASE_URL)
//   2. Descarga la última copia guardada de cada archivo .json y la escribe en disco
//   3. Recién ahí arranca server.js normalmente, que sigue leyendo/escribiendo esos
//      mismos archivos .json como siempre — pero ahora cada vez que se guardan,
//      también quedan respaldados en Postgres (ver el cambio en writeJSONAsync
//      dentro de server.js).
//
// Resultado: aunque Render borre el disco en cada deploy, los datos vuelven a aparecer
// solos al arrancar, porque se restauran desde la base de datos.

require("dotenv").config();
const fs = require("fs");
const path = require("path");

// Todos los archivos de datos que la app guarda localmente. Si en el futuro agregás
// un archivo nuevo (otro "algo.json"), sumalo a esta lista para que también se respalde.
const DATA_FILES = [
  "platform_fee.json",
  "users.json",
  "withdrawals.json",
  "posts.json",
  "dm_messages.json",
  "subscriptions.json",
  "gifts.json",
  "reports.json",
  "recordings.json",
  "scheduled_meetings.json",
  "support_messages.json",
  "monetization_requests.json",
  "meeting_plans.json",
];

async function restoreFromDatabase() {
  if (!process.env.DATABASE_URL) {
    console.warn(
      "[start] ADVERTENCIA: no hay DATABASE_URL configurada. La app va a arrancar " +
      "usando solo los archivos locales que haya (si Render reinició el disco, van a " +
      "estar vacíos). Agregá una base de datos Postgres en Render y su variable " +
      "DATABASE_URL para que esto no vuelva a pasar."
    );
    return;
  }

  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Render (y la mayoría de los Postgres en la nube) requieren SSL, pero con un
    // certificado que Node no reconoce por defecto. Esto lo acepta sin problema.
    ssl: { rejectUnauthorized: false },
  });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_storage (
        key TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    for (const fileName of DATA_FILES) {
      const { rows } = await pool.query(
        "SELECT data FROM app_storage WHERE key = $1",
        [fileName]
      );
      if (rows.length > 0) {
        fs.writeFileSync(
          path.join(__dirname, fileName),
          JSON.stringify(rows[0].data, null, 2)
        );
        console.log(`[start] Restaurado ${fileName} desde la base de datos.`);
      } else {
        console.log(`[start] Todavía no hay datos guardados para ${fileName} (normal si es la primera vez).`);
      }
    }
  } catch (err) {
    console.error("[start] Error restaurando datos desde la base de datos:", err.message);
    console.error("[start] La app va a arrancar igual, con los archivos locales que haya.");
  } finally {
    await pool.end();
  }
}

restoreFromDatabase().finally(() => {
  require("./server.js");
});
