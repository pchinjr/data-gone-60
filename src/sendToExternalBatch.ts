// src/sendToExternalBatch.ts
import { SQSEvent, Context } from "aws-lambda";
import * as AWSXRay from "aws-xray-sdk-core";

// Enable debug logging for X-Ray
AWSXRay.setContextMissingStrategy("LOG_ERROR");

const MAX_RETRIES = 3;

/**
 * Posts a batch of messages to the external endpoint with retry logic.
 */
async function postBatch(endpointUrl: string, messages: unknown[]): Promise<void> {
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    // Create a subsegment for the external HTTP call
    const segment = AWSXRay.getSegment();
    const subsegment = segment?.addNewSubsegment('external-api-call');
    
    try {
      if (subsegment) {
        subsegment.addAnnotation('endpoint', endpointUrl);
        subsegment.addAnnotation('batchSize', messages.length);
        subsegment.addAnnotation('attempt', attempt + 1);
      }
      
      const response = await fetch(endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messages),
      });

      if (!response.ok) {
        const respText = await response.text();
        throw new Error(`HTTP ${response.status}: ${respText}`);
      }

      // Log and exit on success
      console.log("Batch POST succeeded:", await response.text());
      if (subsegment) {
        subsegment.addAnnotation('status', 'success');
        subsegment.close();
      }
      return;
    } catch (error: any) {
      attempt++;
      console.error(`Attempt ${attempt} failed:`, error);
      
      if (subsegment) {
        subsegment.addError(error);
        subsegment.addAnnotation('status', 'failed');
        subsegment.close();
      }

      if (attempt < MAX_RETRIES) {
        // Exponential backoff
        const delay = attempt * 1000;
        console.log(`Retrying in ${delay} ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        console.error("Max retries reached. Throwing error.");
        throw error;
      }
    }
  }
}

/**
 * Lambda handler triggered by SQS events. Sends each batch of Athena-queried records
 * to an external HTTP endpoint.
 */
export const handler = async (event: SQSEvent, context: Context): Promise<void> => {
  console.log("X-Ray trace ID:", process.env._X_AMZN_TRACE_ID || "Not available");
  
  const endpointUrl = process.env.EXTERNAL_ENDPOINT_URL!;

  // Create a subsegment for processing the batch
  const segment = AWSXRay.getSegment();
  const processSubsegment = segment?.addNewSubsegment('process-batch');
  
  try {
    // Parse and filter valid JSON messages
    const messages = event.Records
      .map((record) => {
        try {
          return JSON.parse(record.body);
        } catch (err) {
          console.error("Invalid JSON in record, skipping:", record.body, err);
          return null;
        }
      })
      .filter((msg): msg is unknown => msg !== null);

    if (processSubsegment) {
      processSubsegment.addAnnotation('totalRecords', event.Records.length);
      processSubsegment.addAnnotation('validRecords', messages.length);
      processSubsegment.close();
    }

    if (messages.length === 0) {
      console.log("No valid messages to send.");
      return;
    }

    console.log(`Dispatching batch of ${messages.length} messages to ${endpointUrl}`);

    // Send with retries
    await postBatch(endpointUrl, messages);
    console.log("All messages dispatched successfully.");
  } catch (error) {
    if (processSubsegment && !processSubsegment.isClosed()) {
      processSubsegment.addError(error);
      processSubsegment.close();
    }
    throw error;
  }
};