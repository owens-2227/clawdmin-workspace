# Cron Setup — Daily Pain Point Scan

## Create the Cron Job

In your OpenClaw CLI, create a daily scan job. Recommended time: **7:30 AM** (staggered 30 min after Account A's 7:00 AM scan to avoid any overlap on shared subreddits).

```bash
openclaw cron create \
  --name "Daily Pain Points Scan (Account B)" \
  --schedule "cron 30 7 * * * @ America/Los_Angeles" \
  --task-file /path/to/scan-orchestrator-prompt.md \
  --target isolated
```

Or if you prefer to set it up interactively, just tell your OpenClaw agent:
> "Set up a daily cron job at 7:30 AM PDT that runs the pain point scan using the instructions in scan-orchestrator-prompt.md"

## What Happens Each Morning

1. **7:30 AM PDT** — Cron fires, spawns the orchestrator
2. Orchestrator opens 10 AdsPower profiles
3. Spawns 10 subagents (one per persona)
4. Each subagent browses 3-5 subreddits, writes pain points to MongoDB
5. Orchestrator waits for all completions
6. Closes profiles, compiles report

## Monitoring

The orchestrator will report results. If you want to verify data landed in MongoDB:

```python
from pymongo import MongoClient
from datetime import datetime, timezone, timedelta

client = MongoClient('mongodb+srv://paul_db_user:P3yoLxbhl4fW961l@cluster0.tdvafh8.mongodb.net/?appName=Cluster0')
db = client['reddit_scanner']

# Count today's pain points
today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
count = db['pain_points'].count_documents({'createdAt': {'$regex': f'^{today}'}})
print(f"Pain points created today: {count}")

# Check scan logs
logs = list(db['scan_logs'].find({'scannedAt': {'$regex': f'^{today}'}}).sort('scannedAt', -1))
print(f"Scan logs today: {len(logs)}")
for log in logs:
    print(f"  {log['agentId']} → {log['subreddit']} | {log['painPointsFound']} found | {log['status']}")

client.close()
```

## Prerequisites Checklist

Before the first run, make sure:

- [ ] `pymongo` is installed: `pip3 install pymongo`
- [ ] AdsPower is running with Account B profiles loaded
- [ ] MongoDB Atlas is reachable (test with the Python script above)
- [ ] OpenClaw agent has the `adspower` skill configured
- [ ] Persona subreddit mappings are inserted into MongoDB (see `category-mapping.md`)
- [ ] AdsPower API base URL and auth are in your `TOOLS.md`

## One-Time Setup: Insert Persona Mappings

Before the first scan, insert the Account B persona↔subreddit mappings into MongoDB so the dashboard can properly categorize and filter pain points:

```python
from pymongo import MongoClient

client = MongoClient('mongodb+srv://paul_db_user:P3yoLxbhl4fW961l@cluster0.tdvafh8.mongodb.net/?appName=Cluster0')
db = client['reddit_scanner']
coll = db['persona_subreddits']

mappings = [
    {"persona": "Women's Hormonal Health", "subreddit": "r/Menopause"},
    {"persona": "Women's Hormonal Health", "subreddit": "r/Perimenopause"},
    {"persona": "Plant-Based Diet", "subreddit": "r/PlantBasedDiet"},
    {"persona": "Fitness", "subreddit": "r/xxfitness"},
    {"persona": "Fermentation & Baking", "subreddit": "r/sourdough"},
    {"persona": "Fermentation & Baking", "subreddit": "r/fermentation"},
    {"persona": "Fermentation & Baking", "subreddit": "r/Breadit"},
    {"persona": "Stay-at-Home Parents", "subreddit": "r/SAHP"},
    {"persona": "Sobriety & Recovery", "subreddit": "r/stopdrinking"},
    {"persona": "Coffee", "subreddit": "r/Coffee"},
    {"persona": "Running", "subreddit": "r/ultrarunning"},
    {"persona": "Running", "subreddit": "r/xxrunning"},
    {"persona": "Autoimmune & Thyroid", "subreddit": "r/Hashimotos"},
    {"persona": "Autoimmune & Thyroid", "subreddit": "r/Hypothyroidism"},
    {"persona": "Autoimmune & Thyroid", "subreddit": "r/AutoimmuneProtocol"},
    {"persona": "Chronic Illness", "subreddit": "r/ChronicIllness"},
    {"persona": "Dog Training", "subreddit": "r/reactivedogs"},
    {"persona": "Dog Training", "subreddit": "r/Dogtraining"},
    {"persona": "Dog Training", "subreddit": "r/BorderCollie"},
    {"persona": "Hiking & Outdoors", "subreddit": "r/hiking"},
    {"persona": "Zero Waste & Sustainability", "subreddit": "r/ZeroWaste"},
    {"persona": "Zero Waste & Sustainability", "subreddit": "r/minimalism"},
    {"persona": "Container Gardening", "subreddit": "r/ContainerGardening"},
    {"persona": "Homesteading", "subreddit": "r/BackyardChickens"},
    {"persona": "Homesteading", "subreddit": "r/homestead"},
    {"persona": "Homesteading", "subreddit": "r/vegetablegardening"},
    {"persona": "Homesteading", "subreddit": "r/seedsaving"},
    {"persona": "Canning & Preserving", "subreddit": "r/Canning"},
    {"persona": "Divorce & Life Transitions", "subreddit": "r/Divorce"},
    {"persona": "Divorce & Life Transitions", "subreddit": "r/LifeAfterDivorce"},
    {"persona": "Dating", "subreddit": "r/datingoverthirty"},
    {"persona": "FIRE & Frugality", "subreddit": "r/Fire"},
    {"persona": "FIRE & Frugality", "subreddit": "r/leanfire"},
    {"persona": "FIRE & Frugality", "subreddit": "r/povertyfinance"},
    {"persona": "Neurodivergent Women", "subreddit": "r/ADHDwomen"},
    {"persona": "Neurodivergent Women", "subreddit": "r/AutisticAdults"},
    {"persona": "Neurodivergent Women", "subreddit": "r/AuDHD"},
    {"persona": "Fiber Arts", "subreddit": "r/crochet"},
    {"persona": "Fiber Arts", "subreddit": "r/knitting"},
]

for m in mappings:
    coll.update_one(
        {"persona": m["persona"], "subreddit": m["subreddit"]},
        {"$setOnInsert": m},
        upsert=True
    )
    print(f"  ✓ {m['persona']} → {m['subreddit']}")

print(f"\nTotal persona_subreddits: {coll.count_documents({})}")
client.close()
```
