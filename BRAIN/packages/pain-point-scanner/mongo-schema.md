# MongoDB Atlas — Connection & Schema

## Connection

```
URI: mongodb+srv://paul_db_user:P3yoLxbhl4fW961l@cluster0.tdvafh8.mongodb.net/?appName=Cluster0
Database: reddit_scanner
```

## Collections & Schemas

### `pain_points` — The main table

```json
{
  "_id": "uuid-string",           // crypto.randomUUID()
  "title": "Short clear title",   // max ~80 chars
  "description": "2-3 sentence description of the problem",
  "category": "Primary Persona",  // e.g. "Sobriety & Recovery"
  "subreddit": "r/stopdrinking",  // always prefixed with r/
  "discoveredBy": "keisha-d",     // your agent ID
  "firstSeenAt": "2026-04-01T14:00:00.000Z",  // ISO 8601
  "lastSeenAt": "2026-04-01T14:00:00.000Z",
  "occurrenceCount": 1,
  "status": "new",
  "viralScore": 0,
  "viralAlertThreshold": 0,
  "painPointType": "actionable",    // "actionable" | "informational" | "emotional"
  "createdAt": "2026-04-01T14:00:00.000Z",
  "updatedAt": "2026-04-01T14:00:00.000Z"
}
```

**Upsert logic:** Before inserting, check if a pain point with the same `title` (case-insensitive) AND `subreddit` already exists. If so, increment `occurrenceCount` and update `lastSeenAt` + `updatedAt`. Do NOT create a duplicate.

### `pain_point_personas` — Links pain points to persona categories

```json
{
  "_id": "uuid-string",
  "painPointId": "uuid-of-pain-point",
  "persona": "Sobriety & Recovery"
}
```

One row per (painPointId, persona) pair. A pain point can belong to multiple personas.

### `pain_point_posts` — Source Reddit posts linked to pain points

```json
{
  "_id": "uuid-string",
  "painPointId": "uuid-of-pain-point",
  "redditPostId": "t3_abc123",          // Reddit's post ID
  "redditUrl": "https://reddit.com/r/stopdrinking/comments/abc123/...",
  "postTitle": "Original Reddit post title",
  "postBody": "First 2000 chars of post body (or null)",
  "upvotes": 123,
  "commentCount": 45,
  "subreddit": "r/stopdrinking",
  "discoveredBy": "keisha-d",
  "discoveredAt": "2026-04-01T14:00:00.000Z"
}
```

**Uniqueness:** (redditPostId, painPointId) must be unique — don't link the same post twice.

### `scan_logs` — Per-subreddit scan completion records

```json
{
  "_id": "uuid-string",
  "agentId": "keisha-d",
  "subreddit": "r/stopdrinking",
  "scannedAt": "2026-04-01T14:00:00.000Z",
  "postsScanned": 25,
  "painPointsFound": 3,
  "status": "completed",    // or "error"
  "error": null             // error message if status=error
}
```

### `persona_subreddits` — Maps subreddits to persona categories (for auto-assignment)

```json
{
  "persona": "Sobriety & Recovery",
  "subreddit": "r/stopdrinking"
}
```

## Python Write Examples

```python
from pymongo import MongoClient
import uuid
from datetime import datetime, timezone

MONGO_URI = 'mongodb+srv://paul_db_user:P3yoLxbhl4fW961l@cluster0.tdvafh8.mongodb.net/?appName=Cluster0'
DB_NAME = 'reddit_scanner'

client = MongoClient(MONGO_URI)
db = client[DB_NAME]

def submit_pain_point(title, description, category, subreddit, discovered_by, personas=None):
    """Create or upsert a pain point. Returns the pain point _id."""
    now = datetime.now(timezone.utc).isoformat()
    coll = db['pain_points']
    
    # Check for existing (case-insensitive title + same subreddit)
    import re
    existing = coll.find_one({
        'title': {'$regex': f'^{re.escape(title)}$', '$options': 'i'},
        'subreddit': subreddit
    })
    
    if existing:
        coll.update_one(
            {'_id': existing['_id']},
            {'$inc': {'occurrenceCount': 1}, '$set': {'lastSeenAt': now, 'updatedAt': now}}
        )
        pp_id = existing['_id']
    else:
        pp_id = str(uuid.uuid4())
        coll.insert_one({
            '_id': pp_id,
            'title': title,
            'description': description,
            'category': category,
            'subreddit': subreddit,
            'discoveredBy': discovered_by,
            'firstSeenAt': now,
            'lastSeenAt': now,
            'occurrenceCount': 1,
            'status': 'new',
            'viralScore': 0,
            'viralAlertThreshold': 0,
            'createdAt': now,
            'updatedAt': now,
        })
    
    # Assign personas
    persona_list = personas or [category]
    persona_coll = db['pain_point_personas']
    for persona in persona_list:
        persona_coll.update_one(
            {'painPointId': pp_id, 'persona': persona},
            {'$setOnInsert': {'_id': str(uuid.uuid4()), 'painPointId': pp_id, 'persona': persona}},
            upsert=True
        )
    
    return pp_id

def link_reddit_post(pain_point_id, reddit_post_id, reddit_url, post_title, post_body, upvotes, comment_count, subreddit, discovered_by):
    """Link a source Reddit post to a pain point."""
    now = datetime.now(timezone.utc).isoformat()
    coll = db['pain_point_posts']
    
    # Check uniqueness
    if coll.find_one({'redditPostId': reddit_post_id, 'painPointId': pain_point_id}):
        return None  # already linked
    
    post_id = str(uuid.uuid4())
    coll.insert_one({
        '_id': post_id,
        'painPointId': pain_point_id,
        'redditPostId': reddit_post_id,
        'redditUrl': reddit_url,
        'postTitle': post_title,
        'postBody': (post_body or '')[:2000] if post_body else None,
        'upvotes': upvotes or 0,
        'commentCount': comment_count or 0,
        'subreddit': subreddit,
        'discoveredBy': discovered_by,
        'discoveredAt': now,
    })
    return post_id

def log_scan(agent_id, subreddit, posts_scanned, pain_points_found, status='completed', error=None):
    """Log scan completion for a subreddit."""
    now = datetime.now(timezone.utc).isoformat()
    db['scan_logs'].insert_one({
        '_id': str(uuid.uuid4()),
        'agentId': agent_id,
        'subreddit': subreddit,
        'scannedAt': now,
        'postsScanned': posts_scanned,
        'painPointsFound': pain_points_found,
        'status': status,
        'error': error,
    })
```

## Important Notes

- All `_id` fields are UUID strings (not MongoDB ObjectIds)
- All timestamps are ISO 8601 strings (not BSON dates)
- The `category` field on `pain_points` is the primary persona name
- Multiple personas per pain point are stored in `pain_point_personas` junction table
- Always upsert pain points by title+subreddit to avoid duplicates
