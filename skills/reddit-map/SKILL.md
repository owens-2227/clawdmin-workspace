---
name: reddit-map
description: "Find related subreddits using the Map of Reddit dataset. Shows which subreddits share users (Jaccard similarity from 176M comments). Use for discovering adjacent communities for Reddit engagement."
metadata:
  openclaw:
    skill: true
---

# Reddit Map Skill

Find related subreddits based on real user overlap data from [Map of Reddit](https://anvaka.github.io/map-of-reddit/) by anvaka.

## What It Is

A graph of subreddit relationships built from **176 million comments** (2020-2021). Two subreddits are connected if many users comment in both. The **weight** = Jaccard similarity score (higher = more overlap).

## Data Source

The raw graph is a DOT file at:
```
https://raw.githubusercontent.com/anvaka/map-of-reddit-data/main/graph/reddit-graph.dot
```

Format: `"SubredditA" -> "SubredditB" ["weight"=XX.XX]`

The file is ~18MB. **Do not download the whole file.** Stream and grep for specific subreddits.

## How to Query

### Find all related subreddits for a given sub:
```bash
curl -sL "https://raw.githubusercontent.com/anvaka/map-of-reddit-data/main/graph/reddit-graph.dot" \
  | grep -i '"gardening"' | sort -t= -k2 -rn | head -20
```

This returns both inbound (`X -> gardening`) and outbound (`gardening -> Y`) connections, sorted by weight.

### Find connections between two specific subs:
```bash
curl -sL "https://raw.githubusercontent.com/anvaka/map-of-reddit-data/main/graph/reddit-graph.dot" \
  | grep -i '"ADHD"' | grep -i '"productivity"'
```

### Search multiple subs at once:
```bash
curl -sL "https://raw.githubusercontent.com/anvaka/map-of-reddit-data/main/graph/reddit-graph.dot" \
  | grep -iE '"(gardening|houseplants|IndoorGarden)"' | sort -t= -k2 -rn | head -30
```

## Interpreting Results

| Weight Range | Meaning |
|-------------|---------|
| 40+ | **Very strong** overlap — practically sibling communities |
| 25-40 | **Strong** overlap — highly related, shared user base |
| 15-25 | **Moderate** overlap — adjacent interests |
| 10-15 | **Weak** overlap — tangentially related |

## Use Cases

### 1. Find new subreddits for persona engagement
Given a persona's current subs, find high-overlap communities they'd naturally participate in:
```bash
# Find subs related to r/cats (for Elise C persona)
curl -sL "https://raw.githubusercontent.com/anvaka/map-of-reddit-data/main/graph/reddit-graph.dot" \
  | grep -i '"cats"' | sort -t= -k2 -rn | head -15
```

### 2. Validate subreddit clusters
Check if two subs in a persona's list actually share users:
```bash
curl -sL "https://raw.githubusercontent.com/anvaka/map-of-reddit-data/main/graph/reddit-graph.dot" \
  | grep -i '"Meditation"' | grep -i '"Anxiety"'
```

### 3. Find bridge communities
Discover subs that connect two different interest areas — useful for crossposting or multi-persona overlap:
```bash
# What connects fitness and cooking communities?
curl -sL "https://raw.githubusercontent.com/anvaka/map-of-reddit-data/main/graph/reddit-graph.dot" \
  | grep -iE '"(running|xxfitness|Cooking|MealPrepSunday)"' | sort -t= -k2 -rn
```

### 4. Plan engagement expansion
For our Reddit operation, use this to:
- Discover which new subs a persona should join (high overlap with their existing subs)
- Avoid subs with no natural user overlap (would look suspicious)
- Find small/niche subs that cluster with bigger ones (easier to build karma)

## Visual Tool

The interactive map is at: https://anvaka.github.io/map-of-reddit/

- Click any subreddit dot → "Show Related" to see connections
- Zoom into clusters to find niche communities
- Use `?q=subreddit_name` in the URL to search directly

This is useful for visual exploration but the CLI approach above is better for systematic analysis.

## Caching

The DOT file is static (2020-2021 data). For heavy use, download once:
```bash
curl -sL "https://raw.githubusercontent.com/anvaka/map-of-reddit-data/main/graph/reddit-graph.dot" \
  > ~/.openclaw/workspace/BRAIN/assets/reddit-graph.dot
```
Then grep locally instead of streaming from GitHub each time.

## Limitations

- Data is from 2020-2021 comments — newer subs or shifted communities may not be represented
- Very small subreddits (<~1K subscribers) may not appear
- Weights reflect comment overlap, not subscriber overlap or content similarity
- NSFW subs are included in the dataset
