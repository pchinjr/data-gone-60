# AWS X-Ray Troubleshooting Guide

If you're not seeing X-Ray traces after deploying the application, here are some troubleshooting steps to follow:

## 1. Verify X-Ray Permissions

Ensure that your Lambda functions have the necessary permissions to write to X-Ray:

```yaml
# This policy should be automatically added when Tracing: Active is set
- AWSXrayWriteOnlyAccess
```

You can verify this by checking the IAM role attached to your Lambda functions in the AWS Console.

## 2. Check Lambda Configuration

Verify that X-Ray tracing is actually enabled on your deployed Lambda functions:

1. Go to the AWS Lambda console
2. Select each function (DataIngestFunction, AthenaQueryFunction, SendToExternalBatchFunction)
3. Go to the "Configuration" tab
4. Select "Monitoring and operations tools"
5. Verify that "Active tracing" is enabled under "AWS X-Ray"

If it's not enabled, you may need to manually enable it or check your SAM template.

## 3. Check API Gateway Configuration

Verify that X-Ray tracing is enabled on your API Gateway:

1. Go to the API Gateway console
2. Select your API (DataIngestApi)
3. Go to "Stages" and select your stage (Prod)
4. Check if X-Ray tracing is enabled

## 4. Verify X-Ray SDK Integration

Make sure the X-Ray SDK is properly integrated in your code:

1. The X-Ray SDK is imported in each Lambda function
2. AWS SDK clients are wrapped with `AWSXRay.captureAWSv3Client()`
3. Custom subsegments are properly opened and closed

## 5. Check CloudWatch Logs

Look for any X-Ray related errors in your Lambda function logs:

1. Go to CloudWatch Logs
2. Find the log group for each Lambda function
3. Look for any errors related to X-Ray

## 6. Test with Debug Logging

The updated code includes debug logging for X-Ray. Deploy these changes and check the logs for:

```
X-Ray trace ID: <trace-id> or "Not available"
```

If it shows "Not available", X-Ray might not be properly enabled at the infrastructure level.

## 7. Verify Sampling Rules

X-Ray uses sampling to reduce the amount of data collected. By default, it samples the first request each second and 5% of additional requests.

1. Go to the X-Ray console
2. Select "Sampling"
3. Check if your requests are being sampled

You can create a custom sampling rule to increase the sampling rate for testing.

## 8. Check X-Ray Service Map

Even with minimal traces, you should see something in the X-Ray service map:

1. Go to the X-Ray console
2. Select "Service map"
3. Adjust the time range to include your test period

If you still don't see anything, try increasing the time range or check if X-Ray is enabled in your AWS region.

## 9. Verify AWS SDK Version Compatibility

The AWS X-Ray SDK needs to be compatible with your AWS SDK version. The code has been updated to use the correct approach for AWS SDK v3.

## 10. Manual X-Ray Testing

You can manually test X-Ray by adding a simple trace:

```javascript
const AWSXRay = require('aws-xray-sdk-core');
const segment = new AWSXRay.Segment('test-segment');
// Your code here
segment.close();
```

This creates a standalone segment that should appear in X-Ray traces.