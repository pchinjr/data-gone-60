import { SQSEvent, Context } from "aws-lambda";

const MAX_RETRIES = 3;

async function postBatch(endpointUrl: string, messages: any[]): Promise<void> {
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      // Use global fetch (available in Node.js 20.x)
      const response = await fetch(endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messages)
      });
      if (!response.ok) {
        const respText = await response.text();
        throw new Error(`HTTP ${response.status}: ${respText}`);
      }
      console.log("Batch POST succeeded. Response:", await response.text());
      return; // success
    } catch (error) {
      attempt++;
      console.error(`Attempt ${attempt} failed:`, error);
      if (attempt < MAX_RETRIES) {
        // Exponential backoff: wait for attempt * 1000 ms
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      } else {
        throw error;
      }
    }
  }
}

export const handler = async (event: SQSEvent, context: Context): Promise<void> => {
  // Get external endpoint from environment variable
  const endpointUrl = process.env.EXTERNAL_ENDPOINT_URL || "https://pchinjr-externaldatawarehouse.web.val.run";

  // Aggregate valid messages from SQS records.
  const messages = event.Records.map(record => {
    try {
      return JSON.parse(record.body);
    } catch (error) {
      console.error("Invalid JSON in record, skipping:", record, error);
      return null;
    }
  }).filter(msg => msg !== null);

  if (messages.length === 0) {
    console.log("No valid messages to send.");
    return;
  }

  console.log(`Sending batch of ${messages.length} messages to ${endpointUrl}`);

  try {
    await postBatch(endpointUrl, messages);
  } catch (error) {
    console.error("Error sending batch to external endpoint:", error);
    // Rethrow error so that SQS can retry the batch if necessary.
    throw error;
  }
};