# Cloudflare WAF & Edge Security Configuration

SecureVault relies on defense-in-depth:
1. **Client-side zero-knowledge encryption** (browser AES-256-GCM + ECDH key wrapping).
2. **Application-level rate limiting** (`lib/rateLimit.ts` per IP and per wallet).
3. **Edge / WAF enforcement** (Cloudflare rules below).

---

## 1. Quick Setup via Cloudflare Dashboard

1. Navigate to **Cloudflare Dashboard → Your Domain → Security → WAF**.
2. **Custom Rules**: Create rules corresponding to `waf/cloudflare-rules.json`:
   - **Block Common Exploits**:
     ```text
     (http.request.uri.query contains "<script>" or http.request.uri.query contains "union+select" or http.request.uri.query contains "../")
     Action: Block
     ```
   - **Enforce Origin on API Mutating Requests**:
     ```text
     (http.request.uri.path matches "^/api/" and http.request.method in {"POST", "PUT", "DELETE"} and not (http.request.headers["sec-fetch-site"][0] in {"same-origin", "same-site"}))
     Action: Block
     ```
3. **Rate Limiting Rules**:
   - **Auth Nonce Protection**:
     - Path: `/api/auth/nonce`
     - Rate: 10 requests per 1 minute
     - Action: Block (1 minute timeout)
   - **Auth Verify Protection**:
     - Path: `/api/auth/verify` (POST)
     - Rate: 10 requests per 1 minute
     - Action: Block (5 minute timeout)
   - **File Upload Throttling**:
     - Path: `/api/files` (POST)
     - Rate: 30 requests per 1 minute
     - Action: Managed Challenge

4. **Bot Management**:
   - Enable **Bot Fight Mode** or Challenge automated crawlers with `cf.threat_score > 25`.

---

## 2. Setup via Cloudflare API

You can deploy the ruleset using `curl`:

```bash
curl -X PUT "https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/rulesets/phases/http_request_firewall_custom/entrypoint" \
  -H "Authorization: Bearer <CF_API_TOKEN>" \
  -H "Content-Type: application/json" \
  --data @waf/cloudflare-rules.json
```

---

## 3. Edge Log Invariants

Ensure the Cloudflare Logpush or edge proxy **never logs request bodies** for `/api/files` or `/api/auth/verify`. Plaintext is never transmitted, but preserving ciphertext privacy in log archives is best practice.
