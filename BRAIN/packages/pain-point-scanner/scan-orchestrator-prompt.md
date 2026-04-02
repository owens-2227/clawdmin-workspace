# Scan Orchestrator — Daily Pain Point Scan (Account B)

This is the prompt/instructions for your main OpenClaw agent to dispatch all 10 Account B persona agents for the daily pain point scan.

## Cron Task Prompt

Use this as the `task` for your daily scan cron job:

---

You are running the daily pain point scan for Account B (10 personas, profiles 13-22).

### Step 1: Open AdsPower Profiles

Open each profile one at a time (stagger by ~5 seconds):

```
AdsPower API: http://127.0.0.1:50325/api/v1
Auth Header: (use your configured AdsPower auth — check TOOLS.md)
```

For each profile:
```bash
curl -s "http://127.0.0.1:50325/api/v1/browser/start?user_id={USER_ID}"
```

Parse `data.ws.puppeteer` from the response — that's the CDP URL.

### Step 2: Spawn Subagents

For each persona, spawn a subagent with `sessions_spawn`:

```
agentId: (not needed for subagent runtime)
runtime: "subagent"
mode: "run"
runTimeoutSeconds: 1200
label: "{agent-id}-scan-{YYYY-MM-DD}"
```

The `task` for each subagent must include:
1. The full scan instructions from `SCAN-INSTRUCTIONS.md`
2. Their specific subreddit list
3. Their agent ID
4. The CDP URL from Step 1
5. Their persona voice/category mapping

### Step 3: Agent Roster

| # | Agent ID | user_id | Subreddits | Categories |
|---|----------|---------|-----------|------------|
| 13 | tara-n | k1akk56e | r/Menopause, r/Perimenopause, r/PlantBasedDiet, r/xxfitness, r/PCOS | Women's Hormonal Health, Plant-Based Diet, Fitness |
| 14 | greg-h | k1akk641 | r/sourdough, r/fermentation, r/SAHP, r/Breadit, r/Parenting | Fermentation & Baking, Stay-at-Home Parents, Parenting |
| 15 | keisha-d | k1akk642 | r/stopdrinking, r/Coffee, r/ultrarunning, r/xxrunning, r/DecidingToBeBetter | Sobriety & Recovery, Coffee, Running, Self-Improvement |
| 16 | linda-f | k1akk643 | r/Hashimotos, r/Hypothyroidism, r/AutoimmuneProtocol, r/ChronicIllness, r/Fibromyalgia | Autoimmune & Thyroid, Chronic Illness |
| 17 | maya-r | k1akk644 | r/reactivedogs, r/Dogtraining, r/BorderCollie, r/hiking, r/CampingGear | Dog Training, Hiking & Outdoors |
| 18 | sam-t | k1akk645 | r/ZeroWaste, r/ContainerGardening, r/minimalism, r/Adulting, r/BudgetFood, r/findapath | Zero Waste & Sustainability, Container Gardening, Gen Z & Young Adults |
| 19 | diane-w | k1akk73d | r/BackyardChickens, r/Canning, r/homestead, r/vegetablegardening, r/seedsaving | Homesteading, Canning & Preserving |
| 20 | andrea-m | k1akk73e | r/Divorce, r/datingoverthirty, r/LifeAfterDivorce, r/internetparents, r/LifeAdvice | Divorce & Life Transitions, Dating, Gen Z & Young Adults, Life Transitions |
| 21 | jordan-k | k1akk73f | r/Fire, r/povertyfinance, r/leanfire, r/GenZ, r/CollegeRant, r/StudentLoans | FIRE & Frugality, Gen Z & Young Adults |
| 22 | simone-b | k1akk73g | r/ADHDwomen, r/AutisticAdults, r/AuDHD, r/crochet, r/knitting | Neurodivergent Women, Fiber Arts |

### Step 4: Wait for Completions

After spawning all 10, yield and wait for completion announces. Monitor for:
- Timeouts (>20 min per agent)
- Errors (CAPTCHA, login walls, MongoDB connection failures)
- Zero-result agents (might indicate a problem)

### Step 5: Close Profiles

After all agents complete (or timeout), close each profile:
```bash
curl -s "http://127.0.0.1:50325/api/v1/browser/stop?user_id={USER_ID}"
```

### Step 6: Report

Compile results and report:
- Total pain points discovered across all agents
- Per-agent breakdown (subs scanned, pain points found, status)
- Any errors or issues

### Safety Rules
- Never run more than 2 agents on the same subreddit simultaneously
- If any agent reports CAPTCHA/ban: halt all, report immediately
- Cap each session at 20 minutes max
- Stagger profile opens by 5 seconds (not all at once)
