// valTownDataWarehouse.ts
// HTTP endpoint for receiving batches from SQS via API Gateway + Lambda

export default async function(req: Request): Promise<Response> {
  // Only accept POST
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Dynamically import SQLite
  const { sqlite } = await import("https://esm.town/v/stevekrouse/sqlite");

  // Derive table name from this script's filename
  const parts = new URL(import.meta.url).pathname.split("/");
  const KEY = parts[parts.length - 1].split(".")[0];
  const TABLE_NAME = `${KEY}_sensor_data`;

  // Ensure table exists
  await sqlite.execute(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      sensor_id   TEXT    NOT NULL,
      temperature_c   TEXT NOT NULL,
      raw_humidity    TEXT NOT NULL,
      timestamp       TEXT NOT NULL,
      object_key      TEXT NOT NULL,
      received_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    const payload = await req.json();

    if (!Array.isArray(payload)) {
      return new Response(
        JSON.stringify({ error: "Invalid input: Expected an array" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    let insertedCount = 0;

    for (const entry of payload) {
      // Map both camelCase and lowercase keys
      const sensorId = entry.sensorId ?? entry.sensorid;
      const temperatureC = entry.temperatureC ?? entry.temperaturec;
      const rawHumidity = entry.rawHumidity ?? entry.rawhumidity;
      const timestamp = entry.timestamp;
      const objectKey = entry.objectKey ?? entry.objectkey;

      if (
        !sensorId
        || temperatureC == null
        || rawHumidity == null
        || !timestamp
        || !objectKey
      ) {
        console.error("Skipping malformed entry:", entry);
        continue;
      }

      await sqlite.execute(
        `INSERT INTO ${TABLE_NAME}
         (sensor_id, temperature_c, raw_humidity, timestamp, object_key)
         VALUES (?, ?, ?, ?, ?)
        `,
        [sensorId, temperatureC, rawHumidity, timestamp, objectKey],
      );

      insertedCount++;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        recordsInserted: insertedCount,
        sourceUrl: import.meta.url.replace("esm.town", "val.town"),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("Error processing batch:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}