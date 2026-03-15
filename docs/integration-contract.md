# PitiXAiSales <-> ai-orchestrator-pitix contract

## 1. Process voice sale

`POST /api/pitix/voice-sale/process`

Headers:
- `Authorization: <pitix-access-token>`
- `x-project-id` and `x-user-id` are optional from the app because the body already carries `businessId` and `userId`.

Request body:

```json
{
  "businessId": "pitix_business_id",
  "storeId": "pitix_store_id",
  "userId": "pitix_user_id",
  "saleChannel": "AI Sales Assistant",
  "audio": {
    "base64": "<base64-audio>",
    "mimeType": "audio/m4a"
  },
  "language": {
    "primary": "my-MM",
    "secondary": ["en-US"]
  }
}
```

Response body:

```json
{
  "requestId": "uuid",
  "transcript": "2 coke 1 water customer mg mg",
  "draft": {
    "transcript": "2 coke 1 water customer mg mg",
    "customer": {
      "id": "cust_1",
      "name": "Mg Mg",
      "confidence": 0.92
    },
    "items": [
      {
        "rawText": "2 coke",
        "quantity": 2,
        "unitPrice": 1500,
        "lineTotal": 3000,
        "product": {
          "id": "prod_coke",
          "name": "Coke",
          "confidence": 0.95,
          "unitPrice": 1500,
          "stockId": "stock_1"
        },
        "warnings": []
      }
    ],
    "subtotal": 4500,
    "currencyCode": "MMK",
    "warnings": [],
    "unmatchedPhrases": [],
    "confidence": 0.89,
    "needsClarification": false,
    "recommendedNextAction": "review_and_confirm"
  },
  "meta": {
    "speechProvider": "vertex_gemini",
    "parserProvider": "hybrid_sale_parser",
    "recognizedLanguage": "my-MM",
    "lowConfidence": false,
    "createdAt": "2026-03-14T00:00:00.000Z"
  }
}
```

## 2. Parse transcript without audio

`POST /api/pitix/voice-sale/parse`

Request body:

```json
{
  "businessId": "pitix_business_id",
  "storeId": "pitix_store_id",
  "userId": "pitix_user_id",
  "transcript": "3 fried rice take away",
  "language": {
    "primary": "my-MM",
    "secondary": ["en-US"]
  }
}
```

Response body:
- Same shape as `/process`, except `meta.speechProvider` is `transcript_only`.

## 3. Explicit sale creation

`POST /api/pitix/voice-sale/create`

Request body:

```json
{
  "businessId": "pitix_business_id",
  "storeId": "pitix_store_id",
  "userId": "pitix_user_id",
  "confirmed": true,
  "draft": {
    "...": "same draft payload from process/parse response"
  },
  "saleChannel": {
    "name": "AI Sales Assistant"
  },
  "saleOptions": {
    "saleStatus": "COMPLETED",
    "diningOption": "TakeAway",
    "isPointEligible": false
  },
  "paymentMethod": {
    "id": "optional_payment_method_id",
    "name": "Cash"
  }
}
```

Response body:

```json
{
  "requestId": "uuid",
  "sale": {
    "id": "sale_id",
    "saleNumber": "123456",
    "saleStatus": "COMPLETED",
    "paymentStatus": "PAID",
    "paymentMethod": "Cash",
    "paymentMethodId": "resolved_cash_payment_method_id",
    "totalAmount": 4500,
    "customerName": "Mg Mg"
  },
  "draft": {
    "...": "original confirmed draft"
  }
}
```

Notes:
- If `paymentMethod` is omitted, the create flow resolves the store's `Cash` payment method automatically.
- For normal AI checkout, the create flow now defaults to `"saleStatus": "COMPLETED"` and then records a payment detail so the sale becomes paid in Pitix.
- Use `"saleStatus": "PENDING"` only when you intentionally want a submitted/held order instead of a completed POS sale.

## 4. Error format

All non-2xx responses use:

```json
{
  "error": {
    "code": "machine_readable_code",
    "message": "Human readable explanation",
    "details": {},
    "requestId": "uuid"
  }
}
```

Example codes:
- `missing_context`
- `missing_access_token`
- `missing_audio`
- `missing_transcript`
- `speech_provider_not_configured`
- `missing_stock_id`
- `confirmation_required`

## 5. Temporary Phase A debug routes

These routes are temporary backend debug helpers for Pitix F&B connectivity checks.

`GET /pitix/health`

Response body:

```json
{
  "ok": true,
  "service": "ai-orchestrator-pitix",
  "pitix": {
    "accountGraphqlUrl": "https://api-ext.pitix.app/account",
    "posGraphqlUrl": "https://api-ext.pitix.app/pos",
    "requestTimeoutMs": 15000,
    "debugLogs": false
  }
}
```

`POST /pitix/test-account`

Request body for OTA verification:

```json
{
  "requestId": "ota_request_id"
}
```

Request body for refresh:

```json
{
  "refreshToken": "pitix_refresh_token"
}
```

`POST /pitix/test-pos-read`

Request body:

```json
{
  "token": "pitix_access_token",
  "refreshToken": "optional_pitix_refresh_token",
  "businessId": "pitix_business_id",
  "userId": "pitix_user_id",
  "storeId": "optional_store_id"
}
```

Live FNB connectivity example:

```json
{
  "businessId": "cma0u7rj50002xs6fzhw9il57",
  "userId": "cma0u7rhc0002fuljojapui93",
  "storeId": "cmaawvak10019xjxnp970rcbi",
  "token": "REAL_ACCESS_TOKEN",
  "refreshToken": "REAL_REFRESH_TOKEN"
}
```

Response body:

```json
{
  "ok": true,
  "endpoint": "https://api.pitix.app/pos",
  "operationName": "BusinessPing",
  "elapsedMs": 123,
  "businessId": "biz_1",
  "userId": "user_1",
  "storeId": "store_1",
  "hasRefreshToken": true,
  "result": {
    "found": true,
    "business": {
      "id": "biz_1",
      "name": "Demo Shop"
    }
  }
}
```
