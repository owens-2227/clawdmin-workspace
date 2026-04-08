---
name: ahrefs
description: "Query Ahrefs SEO data via REST API v3: domain ratings, backlinks, organic keywords, keyword research, SERP data, and batch analysis."
metadata:
  openclaw:
    skill: true
---

# Ahrefs API Skill

Query Ahrefs SEO data via their REST API v3: domain ratings, backlinks, organic keywords, keyword research, SERP data, and batch analysis.

## Authentication

All requests require a Bearer token in the `Authorization` header:

```
Authorization: Bearer YOUR_API_KEY
```

API keys are created at https://app.ahrefs.com/account/api-keys (workspace owner/admin only). Keys expire after 1 year.

**Store the API key in TOOLS.md** under an `## Ahrefs` section. Never hardcode it in scripts.

## Base URLs

| Tool | Base URL |
|------|----------|
| Site Explorer | `https://api.ahrefs.com/v3/site-explorer` |
| Keywords Explorer | `https://api.ahrefs.com/v3/keywords-explorer` |
| SERP Overview | `https://api.ahrefs.com/v3/serp-overview` |
| Batch Analysis | `https://api.ahrefs.com/v3/batch-analysis` |
| Rank Tracker | `https://api.ahrefs.com/v3/rank-tracker` |
| Site Audit | `https://api.ahrefs.com/v3/site-audit` |
| Brand Radar | `https://api.ahrefs.com/v3/brand-radar` |

## Rate Limits

- **60 requests per minute** (default)
- HTTP 429 on exceeded rate or dynamic throttling
- Respect `Retry-After` headers

## API Units & Cost

All requests (except free test queries and some endpoints) consume API units:

```
cost = max(base_cost, per_row_cost × num_rows)
```

- **Base cost**: 50 units per request (minimum)
- **Per-row cost**: sum of unique field costs across `select`, `where`, and `order_by`
- **Default field cost**: 1 unit
- **Expensive fields**: marked as `(5 units)` or `(10 units)` in docs (e.g., `traffic`, `org_traffic`, `volume`, `difficulty`)

### Response Headers for Cost Tracking

| Header | Description |
|--------|-------------|
| `x-api-rows` | Number of rows returned |
| `x-api-units-cost-row` | Per-row cost |
| `x-api-units-cost-total` | Calculated total cost |
| `x-api-units-cost-total-actual` | Actual units consumed |
| `x-api-cache` | `hit`, `miss`, or `no_cache` |

**Cost-saving tips:**
- Only `select` the fields you need — each field adds to per-row cost
- Avoid expensive fields (traffic, volume, difficulty) unless needed
- Use `limit` to cap rows
- Cached responses (`x-api-cache: hit`) are free

## Free Test Queries (No Units Consumed)

Use these for development and testing:

- **Site Explorer**: Use `target=ahrefs.com` or `target=wordcount.com`
- **Keywords Explorer / SERP Overview**: Use `keywords=ahrefs` or `keywords=wordcount` (only these exact keywords, no others in the same request)
- Free test queries are capped at `limit=100`

## Common Parameters

All values must be URL-encoded.

| Parameter | Description |
|-----------|-------------|
| `target` | Domain or URL to analyze (required for Site Explorer) |
| `date` | Date in `YYYY-MM-DD` format |
| `country` | ISO 3166-1 alpha-2 code (e.g., `us`, `gb`) |
| `mode` | Scope: `exact`, `prefix`, `domain`, `subdomains` (default: `subdomains`) |
| `protocol` | `both`, `http`, or `https` (default: `both`) |
| `select` | Comma-separated field names to return |
| `where` | JSON filter expression |
| `order_by` | Ordering, e.g., `traffic:desc,keyword:asc` |
| `limit` | Max rows to return |
| `offset` | Pagination offset |
| `output` | `json` (default), `csv`, `xml`, `php` |
| `volume_mode` | `monthly` or `average` (default: `monthly`) |

## Filter Syntax (`where` parameter)

Filters use a JSON expression:

```json
{"and": [
  {"field": "traffic", "is": ["gt", 1000]},
  {"field": "domain_rating_source", "is": ["gte", 50]}
]}
```

### Operators

| Operator | Description |
|----------|-------------|
| `eq` | Equals |
| `neq` | Not equals |
| `gt`, `gte` | Greater than (or equal) |
| `lt`, `lte` | Less than (or equal) |
| `substring` | Contains (case-sensitive) |
| `isubstring` | Contains (case-insensitive) |
| `prefix` | Starts with |
| `suffix` | Ends with |
| `regex` | RE2 regex (Site Explorer) or `*` wildcard (Keywords Explorer) |
| `empty` | Is empty |
| `is_null` | Is null |

### Logical combinators

- `{"and": [...]}` — all conditions must match
- `{"or": [...]}` — any condition must match
- `{"not": {...}}` — negate

### Array fields

- `{"field": "tags", "list_is": {"any": ["eq", "seo"]}}` — any element matches
- `{"field": "tags", "list_is": {"all": ["prefix", "a"]}}` — all elements match

## Key Endpoints Reference

### Site Explorer — Overview

#### Domain Rating
```
GET /v3/site-explorer/domain-rating?target=example.com&date=2024-01-15
```
Returns: `domain_rating` (0-100 scale), `ahrefs_rank`

#### Metrics (Organic/Paid overview)
```
GET /v3/site-explorer/metrics?target=example.com&date=2024-01-15&country=us&mode=subdomains
```
Returns: `org_keywords`, `org_traffic` (10u), `org_cost` (10u), `paid_keywords`, `paid_traffic` (10u), `paid_cost` (10u), `org_keywords_1_3`, `paid_pages`

#### Backlinks Stats
```
GET /v3/site-explorer/backlinks-stats?target=example.com&date=2024-01-15
```

#### History Endpoints
- `/v3/site-explorer/domain-rating-history` — DR over time
- `/v3/site-explorer/url-rating-history` — UR over time
- `/v3/site-explorer/refdomains-history` — Referring domains over time
- `/v3/site-explorer/metrics-history` — Traffic/keywords over time
- `/v3/site-explorer/pages-history` — Indexed pages over time

### Site Explorer — Backlinks

#### All Backlinks
```
GET /v3/site-explorer/all-backlinks?target=example.com&mode=domain&select=url_from,anchor,domain_rating_source,traffic,is_dofollow&limit=100&order_by=domain_rating_source:desc
```
Key fields: `url_from`, `url_to`, `anchor`, `domain_rating_source`, `url_rating_source`, `traffic` (10u), `is_dofollow`, `is_content`, `first_seen`, `last_visited`, `is_lost`, `title`

#### Referring Domains
```
GET /v3/site-explorer/refdomains?target=example.com&mode=domain&select=domain,domain_rating,backlinks,first_seen&limit=50
```

#### New/Lost Backlinks
- `/v3/site-explorer/new-backlinks`
- `/v3/site-explorer/lost-backlinks`

### Site Explorer — Organic Traffic

#### Organic Keywords
```
GET /v3/site-explorer/organic-keywords?target=example.com&country=us&date=2024-01-15&mode=subdomains&select=keyword,best_position,volume,traffic&limit=100&order_by=traffic:desc
```
Key fields: `keyword`, `best_position`, `best_position_url`, `volume` (10u), `traffic` (10u), `keyword_difficulty` (10u), `cpc`, `best_position_kind`

#### Top Pages
```
GET /v3/site-explorer/top-pages?target=example.com&country=us&date=2024-01-15&mode=domain&select=url,traffic,keywords&limit=50&order_by=traffic:desc
```

#### Organic Competitors
```
GET /v3/site-explorer/organic-competitors?target=example.com&country=us&date=2024-01-15
```

### Keywords Explorer

#### Keyword Overview
```
GET /v3/keywords-explorer/overview?country=us&keywords=seo+tools,keyword+research&select=keyword,volume,difficulty,traffic_potential,cpc,parent_topic
```
Key fields: `keyword`, `volume` (10u), `difficulty` (10u), `traffic_potential` (10u), `cpc`, `clicks`, `cps`, `global_volume` (10u), `parent_topic`, `parent_volume` (10u), `serp_features`

#### Volume by Country
```
GET /v3/keywords-explorer/volume-by-country?keyword=seo+tools
```

#### Volume History
```
GET /v3/keywords-explorer/volume-history?country=us&keywords=seo+tools
```

#### Keyword Ideas
- `/v3/keywords-explorer/also-rank-for` — Keywords the top pages also rank for
- `/v3/keywords-explorer/search-suggestions` — Autocomplete suggestions
- `/v3/keywords-explorer/related-terms` — Related terms
- `/v3/keywords-explorer/question-keywords` — Question-form keywords

### SERP Overview
```
GET /v3/serp-overview/serp-overview?country=us&keyword=seo+tools&date=2024-01-15&select=url,position,domain_rating,url_rating,backlinks,traffic&top_positions=10
```

### Batch Analysis
```
POST /v3/batch-analysis/batch-analysis
```
Analyze up to 100 targets in one request.

## Example: Full Domain Audit Script

```bash
AHREFS_KEY="your_key_here"
TARGET="example.com"
DATE=$(date -v-1d +%Y-%m-%d)  # yesterday

# Domain Rating
curl -s "https://api.ahrefs.com/v3/site-explorer/domain-rating?target=$TARGET&date=$DATE" \
  -H "Authorization: Bearer $AHREFS_KEY"

# Organic overview
curl -s "https://api.ahrefs.com/v3/site-explorer/metrics?target=$TARGET&date=$DATE&country=us&mode=subdomains" \
  -H "Authorization: Bearer $AHREFS_KEY"

# Top 20 organic keywords
curl -s "https://api.ahrefs.com/v3/site-explorer/organic-keywords?target=$TARGET&country=us&date=$DATE&mode=subdomains&select=keyword,best_position,volume,traffic&limit=20&order_by=traffic:desc" \
  -H "Authorization: Bearer $AHREFS_KEY"

# Top 10 backlinks by DR
curl -s "https://api.ahrefs.com/v3/site-explorer/all-backlinks?target=$TARGET&mode=domain&select=url_from,anchor,domain_rating_source,traffic,is_dofollow&limit=10&order_by=domain_rating_source:desc" \
  -H "Authorization: Bearer $AHREFS_KEY"
```

## Best Practices

1. **Always use `select`** to return only needed fields — reduces cost
2. **Test with free targets first** (`ahrefs.com` or `wordcount.com`) to verify queries
3. **Check response headers** (`x-api-units-cost-total-actual`) to monitor spend
4. **Use `limit`** — don't pull thousands of rows when you need 50
5. **Cache results locally** when doing repeated analysis on the same target/date
6. **Use `where` filters** to narrow results server-side instead of filtering client-side
7. **Avoid expensive fields** (`traffic`, `volume`, `difficulty` = 10 units each) unless specifically needed
8. **Batch when possible** — use `/batch-analysis` for multi-target metrics instead of N separate calls
9. **Rate limit handling** — implement exponential backoff on 429 responses

## Docs Reference

- Full docs: https://docs.ahrefs.com/
- API intro: https://docs.ahrefs.com/api/docs/introduction
- Endpoint reference: https://docs.ahrefs.com/api/reference/site-explorer
- Filter syntax: https://docs.ahrefs.com/api/docs/filter-syntax
- Parameters: https://docs.ahrefs.com/api/docs/parameters
- Limits & cost: https://docs.ahrefs.com/api/docs/limits-consumption
- Free test queries: https://docs.ahrefs.com/api/docs/free-test-queries
