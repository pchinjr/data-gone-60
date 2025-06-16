# AWS X-Ray Implementation for Data-Gone-60 ETL Pipeline

This document outlines the implementation of AWS X-Ray tracing in the Data-Gone-60 ETL pipeline to enhance observability and provide visual representation of the data flow.

## Implementation Details

### 1. AWS X-Ray SDK Integration

The project uses AWS SDK for JavaScript v3 (modular packages), so we've implemented X-Ray tracing using the `aws-xray-sdk-core` package which supports v3 clients.

```bash
npm install --save aws-xray-sdk-core
```

### 2. Lambda Function Instrumentation

Each Lambda function has been instrumented with X-Ray:

#### Data Ingest Function (`ingestData.ts`)
- Imported the X-Ray SDK
- Wrapped the S3 client with `AWSXRay.captureAWSv3Client()`
- This captures all S3 operations (PutObject) as subsegments in the trace

#### Athena Query Function (`runAthenaQuery.ts`)
- Imported the X-Ray SDK
- Wrapped both Athena and SQS clients with `AWSXRay.captureAWSv3Client()`
- This captures all Athena operations (StartQueryExecution, GetQueryExecution, GetQueryResults) and SQS operations (SendMessage) as subsegments

#### External Batch Function (`sendToExternalBatch.ts`)
- Imported the X-Ray SDK
- Added custom subsegments for the external HTTP calls
- Added annotations for endpoint and batch size
- Properly handled error cases in the subsegment

### 3. Infrastructure Configuration (SAM Template)

The SAM template has been updated to enable X-Ray tracing:

- Added `Tracing: Active` to the `Globals: Function` section to enable tracing for all Lambda functions
- Added `TracingEnabled: true` to the API Gateway configuration

### 4. Visualization and Analysis

With these changes, the X-Ray service map will show:

1. API Gateway → DataIngestFunction → Amazon S3
2. AthenaQueryFunction → Amazon Athena → Amazon SQS
3. SQS → SendToExternalBatchFunction → External API

## Testing the Implementation

To verify the X-Ray implementation:

1. Deploy the updated SAM application
2. Invoke the API Gateway endpoint with sample data
3. Check the X-Ray console to view the service map and traces
4. Verify that all AWS service calls are captured as subsegments
5. Confirm the end-to-end flow is visible in the service map

## Benefits

- **End-to-End Visibility**: Trace requests from API Gateway through all Lambda functions and AWS services
- **Performance Analysis**: Identify bottlenecks in the ETL pipeline
- **Error Tracking**: Quickly pinpoint where failures occur in the pipeline
- **Service Dependencies**: Visualize the relationships between services
- **Enhanced Debugging**: Detailed timing information for each step in the process