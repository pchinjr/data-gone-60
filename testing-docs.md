Below is an example of documentation (in Markdown) that explains the unit tests we’ve written for both the **ingestData** and **runAthenaQuery** functions.

---

# Unit Test Documentation for Data Gone in 60 Seconds Pipeline

This document describes the unit tests for the two key Lambda functions in our pipeline:

1. **ingestData.ts:**  
   - This function receives a POST request, parses the JSON payload, enriches it by partitioning the data by timestamp, and writes it to an S3 bucket.
2. **runAthenaQuery.ts:**  
   - This function runs an Athena query on the raw, partitioned data to filter rows by a specified temperature range (after converting from Fahrenheit to Celsius) for a specific time partition. It then sends matching records as messages to an SQS queue.

---

## Table of Contents

- [Test Setup](#test-setup)
- [ingestData.ts Unit Tests](#ingestdatats-unit-tests)
  - [Overview](#overview-of-ingestdata-tests)
  - [Test Cases](#test-cases-for-ingestdata)
- [runAthenaQuery.ts Unit Tests](#runathenaqueryts-unit-tests)
  - [Overview](#overview-of-runathenaquery-tests)
  - [Test Cases](#test-cases-for-runathenaquery)
- [How to Run the Tests](#how-to-run-the-tests)
- [Dependencies](#dependencies)

---

## Test Setup

- We use **Jest** as the test runner and **ts-jest** for TypeScript support.
- Both functions use the AWS SDK v3. We mock the relevant clients (S3, Athena, and SQS) so that our tests don’t make real calls to AWS.
- Environment variables required by the functions are set up in the tests to simulate production configuration.
- For **ingestData.ts**, we validate that the S3 object key is partitioned by time.
- For **runAthenaQuery.ts**, we simulate the lifecycle of an Athena query and validate that matching records result in SQS messages being sent.

---

## ingestData.ts Unit Tests

### Overview of ingestData Tests

The unit tests for `ingestData.ts` cover:
- **Successful Data Ingestion:**  
  Verifies that when a valid JSON payload (containing a timestamp) is provided, the function:
  - Parses the JSON.
  - Extracts the timestamp.
  - Constructs an S3 key in a partitioned format (`raw/YYYY/MM/DD/HH/mm/<uuid>.json`).
  - Calls the S3 client's `send` method with a `PutObjectCommand`.
  - Returns a 200 response with the S3 object key in the response body.

- **Error Handling for Invalid JSON:**  
  Verifies that when an invalid JSON payload is received, the function catches the error and returns a 400 status code with an appropriate error message (e.g., "Invalid JSON format").

### Test Cases for ingestData

1. **Valid Payload Test:**
   - **Input:** A JSON object with fields `sensorId`, `rawTemperature`, `rawHumidity`, and a valid ISO `timestamp`.
   - **Expected Behavior:**
     - The function should partition the key based on the timestamp.
     - The S3 client's `send` method should be called exactly once with a `PutObjectCommand`.
     - The response should have a 200 status code and include a message `"Data successfully ingested"` along with a partitioned S3 key.
   - **Assertions:**  
     - Response status code is 200.
     - The `objectKey` returned matches the regex pattern:  
       ```
       ^raw\/\d{4}\/\d{2}\/\d{2}\/\d{2}\/\d{2}\/[a-f0-9\-]+\.json$
       ```
     - The S3 mock is called once.

2. **Invalid JSON Test:**
   - **Input:** A string `"invalid-json"` instead of valid JSON.
   - **Expected Behavior:**
     - The JSON parsing will fail.
     - The function logs the error and returns a 400 response with an error message `"Invalid JSON format"`.
   - **Assertions:**  
     - Response status code is 400.
     - The returned body contains an error field.

---

## runAthenaQuery.ts Unit Tests

### Overview of runAthenaQuery Tests

The unit tests for `runAthenaQuery.ts` cover:
- **Successful Athena Query Execution:**  
  - Simulate the Athena query lifecycle:
    1. `StartQueryExecution` returns a query execution ID.
    2. `GetQueryExecution` returns a status of `"SUCCEEDED"`.
    3. `GetQueryResults` returns a result set with one header row and two data rows.
  - Verify that the function sends SQS messages for each data row (skipping the header row).
  - The function returns a 200 response with a message and a count of processed rows.

- **Athena Query Failure:**  
  - Simulate a failure where `GetQueryExecution` returns a status of `"FAILED"`.
  - The function returns a 500 response with an error message indicating the failure status.

### Test Cases for runAthenaQuery

1. **Successful Query Test:**
   - **Simulated Responses:**
     - `StartQueryExecution`: Returns `{ QueryExecutionId: "query123" }`.
     - `GetQueryExecution`: Returns a SUCCEEDED status.
     - `GetQueryResults`: Returns a header row and two data rows.
     - `SQSClient.send`: Resolves successfully for each message.
   - **Expected Behavior:**
     - The function returns a 200 response.
     - The response indicates that two rows were processed.
     - SQS send is called twice (once for each matching record).
   - **Assertions:**  
     - Status code is 200.
     - The response body contains `"processedRows": 2`.
     - `mockSQSSend` has been called exactly twice.

2. **Query Failure Test:**
   - **Simulated Responses:**
     - `StartQueryExecution`: Returns a query execution ID.
     - `GetQueryExecution`: Returns a status of `"FAILED"`.
   - **Expected Behavior:**
     - The function returns a 500 response.
     - The error message includes the query failure status.
   - **Assertions:**  
     - Status code is 500.
     - The error message in the response body indicates that the query failed with status FAILED.

### Mocking and Dynamic Import

- **Dynamic Import:**  
  The tests use dynamic import (inside a `beforeAll` block) to load the handler after the mocks are defined, ensuring that our mocks are in place.
- **Module-Level Mocks:**  
  We declare `mockAthenaSend` and `mockSQSSend` before calling `jest.mock` so that they are available to our mock factories.

---

## How to Run the Tests

1. **Install Dependencies:**  
   Ensure you have installed the necessary packages:
   ```bash
   npm install --save-dev jest ts-jest @types/jest
   ```

2. **Run Jest:**  
   Execute the tests with:
   ```bash
   npm test
   ```
   or
   ```bash
   npx jest
   ```

3. **Review the Output:**  
   - The tests for `ingestData.ts` should pass, indicating that data is partitioned correctly and that invalid JSON results in a 400 response.
   - The tests for `runAthenaQuery.ts` should pass, simulating both successful query execution and query failures.

---

## Dependencies

- **Jest:** For running unit tests.
- **ts-jest:** For transpiling TypeScript tests on the fly.
- **AWS SDK v3:** Mocked for Athena, SQS, and S3 clients.
- **Type Definitions:** `@types/jest` and `@types/aws-lambda`.

---