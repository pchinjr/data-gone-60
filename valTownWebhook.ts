export default async function(req: Request): Promise<Response> {
    // Only accept POST requests
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
  
    // Import SQLite dynamically
    const { sqlite } = await import("https://esm.town/v/stevekrouse/sqlite");
  
    // Use the val's unique URL as part of the table name to ensure uniqueness
    const KEY = new URL(import.meta.url).pathname.split("/").at(-1);
    const TABLE_NAME = `${KEY}_sensor_data_1`;
  
    // Ensure table exists
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sensor_id TEXT NOT NULL,
        temperature_c TEXT NOT NULL,
        raw_humidity TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        object_key TEXT NOT NULL,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  
    try {
      // Parse incoming JSON
      const sensorData = await req.json();
  
      // Validate input is an array
      if (!Array.isArray(sensorData)) {
        return new Response("Invalid input: Expected an array", { status: 400 });
      }
  
      // Prepare batch insert
      for (const entry of sensorData) {
        await sqlite.execute(
          `
          INSERT INTO ${TABLE_NAME} 
          (sensor_id, temperature_c, raw_humidity, timestamp, object_key) 
          VALUES (?, ?, ?, ?, ?)
        `,
          [
            entry.sensorId,
            entry.temperatureC,
            entry.rawHumidity,
            entry.timestamp,
            entry.objectKey,
          ],
        );
      }
  
      // Return success response
      return Response.json({
        ok: true,
        recordsInserted: sensorData.length,
        sourceUrl: import.meta.url.replace("esm.town", "val.town"),
      });
    } catch (error) {
      // Handle any parsing or database errors
      return new Response(`Error processing request: ${error.message}`, { status: 500 });
    }
  }