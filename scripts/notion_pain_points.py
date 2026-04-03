#!/usr/bin/env python3
"""Create Notion database for Wabi pain point analysis and populate it."""

import json
import time
import urllib.request

NOTION_SECRET = "REDACTED_NOTION"
PARENT_PAGE_ID = "31b66005-ab52-800d-9c49-fbc517921ae3"
NOTION_VERSION = "2022-06-28"
BASE = "https://api.notion.com/v1"

HEADERS = {
    "Authorization": f"Bearer {NOTION_SECRET}",
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
}

def notion_request(method, endpoint, data=None):
    url = f"{BASE}{endpoint}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"ERROR {e.code}: {err}")
        raise

# Step 1: Create the database
print("Creating database...")
db_payload = {
    "parent": {"type": "page_id", "page_id": PARENT_PAGE_ID},
    "title": [{"type": "text", "text": {"content": "🎯 Top 50 Pain Points — Wabi App Analysis"}}],
    "properties": {
        "Pain Point": {"title": {}},
        "Subreddit": {"rich_text": {}},
        "Viral Score": {"number": {}},
        "Wabi Fit (1-5)": {"number": {}},
        "App Idea": {"rich_text": {}},
        "Analysis": {"rich_text": {}},
    }
}

db = notion_request("POST", "/databases", db_payload)
db_id = db["id"]
print(f"Database created: {db_id}")

# Step 2: All 50 pain points with analysis
rows = [
    {
        "pain_point": "Sudden Windfall Financial Guidance Gap",
        "subreddit": "r/personalfinance",
        "viral_score": 95,
        "wabi_fit": 5,
        "app_idea": "Windfall Roadmap — step-by-step guided planner that walks users through what to do with a sudden lump sum (emergency fund, debts, taxes, investing) based on their situation.",
        "analysis": "Perfect Wabi fit: a guided questionnaire + personalized checklist requires no real-time data, just decision-tree logic. High viral potential given massive engagement."
    },
    {
        "pain_point": "Home Energy Efficiency — Hidden Savings",
        "subreddit": "r/frugal",
        "viral_score": 92,
        "wabi_fit": 5,
        "app_idea": "Home Energy Savings Finder — quiz-based tool that identifies energy waste by room/appliance and surfaces free audit programs by zip code.",
        "analysis": "Excellent Wabi fit: quiz + guide format with static reference data. Users input home details, get actionable savings tips and local program links."
    },
    {
        "pain_point": "Night Motivation vs Morning Follow-Through Gap",
        "subreddit": "r/productivity",
        "viral_score": 90,
        "wabi_fit": 5,
        "app_idea": "Night-to-Morning Bridge — capture evening intentions in a structured form, generates a simplified morning action card with just 1-3 concrete first steps.",
        "analysis": "Perfect Wabi fit: simple form capture + morning display. No backend needed, works as a bookmarkable tool with local storage."
    },
    {
        "pain_point": "Bike-Friendly Affordable City Finder",
        "subreddit": "r/bikecommuting",
        "viral_score": 88,
        "wabi_fit": 4,
        "app_idea": "Bike City Scorer — compare cities on cycling infrastructure, cost of living, climate, and safety using curated static dataset with filtering/sorting.",
        "analysis": "Strong fit with static curated data for top 100+ cities. Loses a point because truly comprehensive data would need regular updates, but a curated guide works well."
    },
    {
        "pain_point": "ADHD Basic Hygiene Habit Automation",
        "subreddit": "r/ADHD",
        "viral_score": 82,
        "wabi_fit": 5,
        "app_idea": "ADHD Hygiene Buddy — visual checklist with dopamine-friendly design (streaks, celebrations), customizable routine builder with time-of-day triggers.",
        "analysis": "Perfect Wabi fit: tracker/checklist with gamification elements. ADHD-specific UX (minimal steps, visual rewards) is achievable in a mini app."
    },
    {
        "pain_point": "Food Safety Knowledge Gaps in Home Cooking",
        "subreddit": "r/cooking",
        "viral_score": 80,
        "wabi_fit": 5,
        "app_idea": "Kitchen Safety Quick Check — searchable guide + quiz on food safety facts (temps, toxins, storage times) with myth-busting format.",
        "analysis": "Perfect Wabi fit: static reference guide + quiz format. No external data needed, purely educational content that's bookmarkable."
    },
    {
        "pain_point": "ADHD Work and Life Overwhelm",
        "subreddit": "r/ADHD",
        "viral_score": 79,
        "wabi_fit": 4,
        "app_idea": "ADHD Triage Tool — brain dump capture → automatic categorization into life domains → surfaces ONE next action per domain to break paralysis.",
        "analysis": "Strong fit as a structured planning tool. Loses a point because true overwhelm recovery may need ongoing support beyond a single tool, but the triage concept works well."
    },
    {
        "pain_point": "Remote Work Social Isolation and Skill Atrophy",
        "subreddit": "r/remotework",
        "viral_score": 78,
        "wabi_fit": 3,
        "app_idea": "Social Muscle Tracker — weekly social interaction logger + guided challenges to rebuild social skills (conversation starters, meetup planning prompts).",
        "analysis": "Moderate fit: tracking and guided challenges work, but the core problem (actual social connection) requires real-world action and community platforms beyond Wabi's scope."
    },
    {
        "pain_point": "TMJ Self-Help Knowledge Gap",
        "subreddit": "r/TMJ",
        "viral_score": 76,
        "wabi_fit": 5,
        "app_idea": "TMJ Self-Care Guide — illustrated guide to proper tongue posture, jaw exercises, and daily habits with progress tracker and symptom diary.",
        "analysis": "Perfect Wabi fit: educational guide + habit tracker. Static content with personal tracking, exactly what a mini app excels at."
    },
    {
        "pain_point": "Home Cook Technique Gap",
        "subreddit": "r/cooking",
        "viral_score": 75,
        "wabi_fit": 5,
        "app_idea": "Restaurant Secrets Decoder — searchable guide of pro cooking techniques (pan heat, resting meat, sauce building) organized by dish type with video links.",
        "analysis": "Perfect Wabi fit: curated reference guide format. Static educational content organized for quick lookup, highly bookmarkable."
    },
    {
        "pain_point": "Phone Addiction — Beyond App Blocking",
        "subreddit": "r/productivity",
        "viral_score": 75,
        "wabi_fit": 4,
        "app_idea": "Phone Urge Interceptor — when you feel the urge to scroll, open this instead: quick reflection prompt, alternative activity suggestion, and urge-surfing timer.",
        "analysis": "Strong fit as a behavioral intervention tool. Works as a replacement habit bookmark. Slight limitation: can't actually block other apps, but the psychological approach is the point."
    },
    {
        "pain_point": "Solo Travel Social Isolation for Non-Drinkers",
        "subreddit": "r/solotravel",
        "viral_score": 74,
        "wabi_fit": 4,
        "app_idea": "Sober Social Travel Guide — curated guide of alcohol-free social activities by destination + conversation starters + hostel social strategy tips.",
        "analysis": "Strong fit as a reference guide with city-specific tips. Loses a point because comprehensive city coverage needs ongoing curation, but the format is ideal."
    },
    {
        "pain_point": "Divorce Financial Decision Complexity",
        "subreddit": "r/personalfinance",
        "viral_score": 74,
        "wabi_fit": 5,
        "app_idea": "Divorce Asset Calculator — model different settlement scenarios (keep house vs split 401k, alimony variations) and see long-term financial projections.",
        "analysis": "Perfect Wabi fit: calculator/modeling tool with form inputs and computed outputs. No real-time data needed, just financial math logic."
    },
    {
        "pain_point": "Baby Sleep Pattern Guidance",
        "subreddit": "r/beyondthebump",
        "viral_score": 73,
        "wabi_fit": 5,
        "app_idea": "Baby Sleep Tracker & Guide — log sleep/wake times, see patterns emerge, get age-appropriate guidance based on logged data. Cuts through conflicting advice.",
        "analysis": "Perfect Wabi fit: tracker + personalized guidance based on inputs. Parents log data, app surfaces patterns and evidence-based recommendations."
    },
    {
        "pain_point": "Conflicting Credit Card Advice for Young Adults",
        "subreddit": "r/personalfinance",
        "viral_score": 72,
        "wabi_fit": 5,
        "app_idea": "First Credit Card Decision Tree — guided quiz based on income, spending, goals → recommends card strategy with clear reasoning for each step.",
        "analysis": "Perfect Wabi fit: decision-tree quiz format with educational content. No real-time data needed, just structured guidance logic."
    },
    {
        "pain_point": "Procrastination Perfectionism Loop",
        "subreddit": "r/productivity",
        "viral_score": 72,
        "wabi_fit": 5,
        "app_idea": "Imperfect Start Timer — enter your task, get a 'good enough' version prompt, 10-min timer, and permission to do it badly. Tracks completed imperfect starts.",
        "analysis": "Perfect Wabi fit: simple behavioral tool with timer and tracker. Addresses psychological barrier with a lightweight, bookmarkable intervention."
    },
    {
        "pain_point": "Accessible Film Scanning Without Expensive Equipment",
        "subreddit": "r/AnalogCommunity",
        "viral_score": 72,
        "wabi_fit": 4,
        "app_idea": "DIY Film Scan Setup Builder — input your budget and gear, get matched scanning setup recommendations (camera + light source + holder combos) with quality comparisons.",
        "analysis": "Strong fit as a gear-matching guide/calculator. Curated database of setups works well, though keeping product availability current is a minor limitation."
    },
    {
        "pain_point": "Film Defect Diagnosis",
        "subreddit": "r/AnalogCommunity",
        "viral_score": 72,
        "wabi_fit": 4,
        "app_idea": "Film Defect Identifier — visual guide showing common defects (light leaks, focus issues, exposure problems) with example images and diagnostic flowchart.",
        "analysis": "Strong fit as a visual reference/diagnostic guide. Works great as a static flowchart tool. Loses a point because ideal version would use image upload/AI analysis."
    },
    {
        "pain_point": "WFH Time Perception Loss",
        "subreddit": "r/remotework",
        "viral_score": 71,
        "wabi_fit": 5,
        "app_idea": "WFH Progress Journal — weekly check-in form capturing accomplishments, milestones, and life events. Generates monthly/quarterly timeline view of your life.",
        "analysis": "Perfect Wabi fit: simple form + timeline visualization using local storage. Directly addresses the blurring problem with structured reflection."
    },
    {
        "pain_point": "Post-Death Medical Bill Management",
        "subreddit": "r/personalfinance",
        "viral_score": 70,
        "wabi_fit": 5,
        "app_idea": "After-Death Bill Navigator — step-by-step guide for handling deceased family member's medical bills, with checklist of what you do/don't owe and letter templates.",
        "analysis": "Perfect Wabi fit: guided checklist + reference content + templates. Highly valuable static content that people desperately need in a crisis moment."
    },
    {
        "pain_point": "Cyclist Accountability Gap After Fatal Accidents",
        "subreddit": "r/fuckcars",
        "viral_score": 70,
        "wabi_fit": 4,
        "app_idea": "Cycling Incident Documenter — structured form for recording incident details, witness info, photos, and generating reports for police/insurance/advocacy.",
        "analysis": "Strong fit as a structured documentation form with report generation. Slight limitation: ideally would integrate with mapping/reporting databases, but standalone documentation is highly valuable."
    },
    {
        "pain_point": "Real-Time Travel Alert and Itinerary Adjustment",
        "subreddit": "r/solotravel",
        "viral_score": 69,
        "wabi_fit": 2,
        "app_idea": "Travel Disruption Checklist — pre-trip contingency planner: for each leg, document backup options, embassy contacts, insurance info.",
        "analysis": "Weak fit for real-time alerts (needs live data feeds, APIs). A static contingency planner is possible but doesn't solve the core real-time problem."
    },
    {
        "pain_point": "Conflicting Medical Advice for New Parents",
        "subreddit": "r/beyondthebump",
        "viral_score": 68,
        "wabi_fit": 4,
        "app_idea": "Baby Advice Tracker — log advice from each provider, flag contradictions, and reference evidence-based guidelines to help conversations with doctors.",
        "analysis": "Strong fit as a tracking/logging tool with reference content. Slight limitation: medical guidance requires careful disclaimers, but the tracking + reference format works."
    },
    {
        "pain_point": "App-Based Language Learning Fails Real Conversations",
        "subreddit": "r/languagelearning",
        "viral_score": 68,
        "wabi_fit": 3,
        "app_idea": "Conversation Prep Cards — scenario-based phrase guides (ordering food, asking directions, small talk) with self-assessment tracker for real-world practice.",
        "analysis": "Moderate fit: reference cards and self-tracking work, but the core problem (practicing actual conversation) needs interactive/audio features beyond typical Wabi scope."
    },
    {
        "pain_point": "Chronic Insomnia with No Effective Medical Path",
        "subreddit": "r/insomnia",
        "viral_score": 68,
        "wabi_fit": 4,
        "app_idea": "Insomnia Root Cause Explorer — guided questionnaire mapping sleep history, medications tried, lifestyle factors → generates structured summary for doctor visits.",
        "analysis": "Strong fit as a diagnostic questionnaire + medical visit prep tool. Helps users organize their sleep history systematically for better doctor conversations."
    },
    {
        "pain_point": "Credit Card Debt Escape Plan for Young Adults",
        "subreddit": "r/personalfinance",
        "viral_score": 66,
        "wabi_fit": 5,
        "app_idea": "Debt Snowball/Avalanche Calculator — input debts, income, expenses → see payoff timeline for both strategies with monthly payment plan and milestone celebrations.",
        "analysis": "Perfect Wabi fit: pure calculator/planner with form inputs and computed outputs. Classic mini app use case with high practical value."
    },
    {
        "pain_point": "Strength Training vs Running Balance",
        "subreddit": "r/xxfitness",
        "viral_score": 65,
        "wabi_fit": 5,
        "app_idea": "Hybrid Training Periodizer — input your running and lifting goals, get a weekly split that balances both with built-in deload scheduling.",
        "analysis": "Perfect Wabi fit: planner/calculator that takes goals and generates a structured training schedule. Static logic, no real-time data needed."
    },
    {
        "pain_point": "Mindfulness Apps Fail ADHD Users",
        "subreddit": "r/ADHD",
        "viral_score": 65,
        "wabi_fit": 4,
        "app_idea": "ADHD Mindfulness Micro-Tool — ultra-short (30-90 sec) guided exercises designed for ADHD brains: fidget-friendly, movement-based, with novelty rotation.",
        "analysis": "Strong fit as a guide/timer tool with ADHD-specific design. Slight limitation: audio guidance would enhance it, but text-based micro-exercises still work."
    },
    {
        "pain_point": "Building Consistent Kids Reading Habits",
        "subreddit": "r/Mommit",
        "viral_score": 64,
        "wabi_fit": 5,
        "app_idea": "Kids Reading Streak Tracker — log books read, build streaks, earn badges, get age-appropriate book suggestions. Visual bookshelf fills up over time.",
        "analysis": "Perfect Wabi fit: tracker with gamification, exactly what Wabi excels at. Visual progress + streak mechanics drive consistent habits."
    },
    {
        "pain_point": "Video and Podcast Knowledge Retention",
        "subreddit": "r/productivity",
        "viral_score": 63,
        "wabi_fit": 4,
        "app_idea": "Content Capture Cards — quick-entry form for key takeaways after watching/listening, with spaced repetition review reminders to reinforce retention.",
        "analysis": "Strong fit as a capture + review tool. Slight limitation: ideal version would integrate with podcast/video apps, but standalone capture still addresses the core problem."
    },
    {
        "pain_point": "Hostel Social Discovery",
        "subreddit": "r/solotravel",
        "viral_score": 62,
        "wabi_fit": 3,
        "app_idea": "Hostel Vibe Rater — crowdsourced form where travelers rate hostel social atmosphere on specific dimensions (common area quality, events, solo-friendly).",
        "analysis": "Moderate fit: the rating form works, but crowdsourced data collection and display needs a backend/community that's beyond a simple mini app."
    },
    {
        "pain_point": "Language Exchange Apps — Safety Issues",
        "subreddit": "r/languagelearning",
        "viral_score": 62,
        "wabi_fit": 2,
        "app_idea": "Language Exchange Safety Guide — checklist of red flags, safety tips, and platform comparison with safety ratings.",
        "analysis": "Weak fit: the core problem needs a platform with user verification and moderation. A safety guide is helpful but doesn't solve the fundamental platform issue."
    },
    {
        "pain_point": "TMJ Treatment Confusion",
        "subreddit": "r/TMJ",
        "viral_score": 62,
        "wabi_fit": 4,
        "app_idea": "TMJ Treatment Tracker — log treatments tried, rate effectiveness, see what works for your symptom profile. Includes treatment option guide with evidence ratings.",
        "analysis": "Strong fit as a personal treatment tracker + reference guide. Crowdsourced data would need a backend, but personal tracking + curated guide works well."
    },
    {
        "pain_point": "Early Morning Wake Cycle — No Protocol",
        "subreddit": "r/insomnia",
        "viral_score": 62,
        "wabi_fit": 5,
        "app_idea": "3AM Wake Protocol — step-by-step guide for what to do when you wake at 3am, with tracking to identify patterns and CBT-i based intervention suggestions.",
        "analysis": "Perfect Wabi fit: guide + tracker combo. Simple protocol content with sleep pattern logging to identify triggers over time."
    },
    {
        "pain_point": "Running Training Load Balance",
        "subreddit": "r/running",
        "viral_score": 60,
        "wabi_fit": 4,
        "app_idea": "Training Load Translator — input your Garmin/watch metrics, get plain-English interpretation with actionable next-week adjustments.",
        "analysis": "Strong fit as a calculator/interpreter tool. Manual data entry is a slight friction point vs auto-sync, but the interpretation layer adds real value."
    },
    {
        "pain_point": "ADHD Decluttering Loop",
        "subreddit": "r/ADHD",
        "viral_score": 60,
        "wabi_fit": 5,
        "app_idea": "ADHD Declutter Decision Helper — for each item: quick yes/no/maybe flow with ADHD-friendly prompts, timer-boxed sessions, and progress visualization.",
        "analysis": "Perfect Wabi fit: decision-tree tool with timer and progress tracking. Breaks the paralysis with structured micro-decisions."
    },
    {
        "pain_point": "Sleep Medication Dependency & Tapering",
        "subreddit": "r/insomnia",
        "viral_score": 60,
        "wabi_fit": 4,
        "app_idea": "Sleep Med Taper Planner — input current medication/dose, get a gradual reduction schedule with symptom tracking and when-to-call-doctor guidelines.",
        "analysis": "Strong fit as a planning/tracking tool. Requires medical disclaimers and should emphasize doctor involvement, but the structured planning format works."
    },
    {
        "pain_point": "New Diabetic Cat Owner Onboarding",
        "subreddit": "r/felinediabetes",
        "viral_score": 60,
        "wabi_fit": 5,
        "app_idea": "Diabetic Cat Starter Guide — step-by-step onboarding: glucose testing tutorial, target ranges explained, injection technique guide, feeding schedule planner + glucose log.",
        "analysis": "Perfect Wabi fit: guided onboarding + tracker. Consolidates scattered forum knowledge into one structured tool with ongoing glucose logging."
    },
    {
        "pain_point": "AI Images Polluting Gardening Platforms",
        "subreddit": "r/gardening",
        "viral_score": 58,
        "wabi_fit": 2,
        "app_idea": "Real Garden Photo Guide — curated plant identification guide using only verified real photos with growing tips.",
        "analysis": "Weak fit: the core problem is platform-level content moderation at scale. A Wabi guide can offer authentic content but can't fix the polluted platforms people currently use."
    },
    {
        "pain_point": "Remote Team Context Loss",
        "subreddit": "r/remotework",
        "viral_score": 58,
        "wabi_fit": 3,
        "app_idea": "Team Context Logger — structured form for logging decisions, context, and rationale after meetings, searchable by topic/date.",
        "analysis": "Moderate fit: individual logging works but the core problem is team-wide information architecture requiring multi-user collaboration tools beyond a mini app."
    },
    {
        "pain_point": "DIY Bike Repair Compatibility Confusion",
        "subreddit": "r/bikewrench",
        "viral_score": 58,
        "wabi_fit": 4,
        "app_idea": "Bike Parts Compatibility Checker — input your bike specs (groupset, wheel size, etc.), get compatible parts list for common repairs + required tools.",
        "analysis": "Strong fit as a reference/lookup tool with curated compatibility data. Bike standards are relatively stable, making static data viable."
    },
    {
        "pain_point": "TMJ Cascading Symptoms — No Unified Tracker",
        "subreddit": "r/TMJ",
        "viral_score": 58,
        "wabi_fit": 5,
        "app_idea": "TMJ Symptom Web Tracker — log all TMJ-related symptoms (jaw, ear, neck, headache) daily with severity, see correlations and generate specialist-ready reports.",
        "analysis": "Perfect Wabi fit: multi-symptom tracker with visualization. Exactly the kind of personal health logging tool that works as a mini app."
    },
    {
        "pain_point": "Affordable Insulin Sourcing for Diabetic Cats",
        "subreddit": "r/felinediabetes",
        "viral_score": 58,
        "wabi_fit": 4,
        "app_idea": "Cat Insulin Price Finder — curated guide to discount insulin sources (compounding pharmacies, Canadian imports, manufacturer programs) with cost comparison.",
        "analysis": "Strong fit as a curated resource guide with price comparisons. Prices need periodic updates but the source list is relatively stable."
    },
    {
        "pain_point": "Film Travel Anxiety — X-Ray Damage",
        "subreddit": "r/AnalogCommunity",
        "viral_score": 55,
        "wabi_fit": 5,
        "app_idea": "Film Travel Scanner Guide — searchable database of airport scanner types by country/airport, plus packing tips and hand-check request templates.",
        "analysis": "Perfect Wabi fit: curated reference database with search/filter. Static data that's extremely useful and bookmarkable for traveling photographers."
    },
    {
        "pain_point": "Bike Light Charging Forgetting",
        "subreddit": "r/bikecommuting",
        "viral_score": 52,
        "wabi_fit": 5,
        "app_idea": "Bike Maintenance Reminder — set custom reminders for light charging, tire pressure checks, chain lube, etc. with simple check-off and next-due tracking.",
        "analysis": "Perfect Wabi fit: simple recurring task tracker/reminder tool. Lightweight, focused, exactly what a mini app should be."
    },
    {
        "pain_point": "Post-Viral Insomnia Pattern Recognition",
        "subreddit": "r/insomnia",
        "viral_score": 45,
        "wabi_fit": 5,
        "app_idea": "Post-COVID Sleep Tracker — specialized sleep diary tracking onset timing, illness history, and symptom patterns to identify post-viral insomnia signatures.",
        "analysis": "Perfect Wabi fit: specialized tracker with pattern visualization. Niche but valuable — helps users and their doctors identify the post-viral connection."
    },
    {
        "pain_point": "Multi-Modal Commute Bike Bag Ergonomics",
        "subreddit": "r/bikecommuting",
        "viral_score": 44,
        "wabi_fit": 5,
        "app_idea": "Commute Bag Selector — quiz-based tool: input your commute type (bike+train, bike only), gear needs, and body type → get bag type recommendation with pros/cons.",
        "analysis": "Perfect Wabi fit: decision-tree quiz with curated product recommendations. Simple, focused, highly useful for the target audience."
    },
    {
        "pain_point": "Film Lab Reliability & Accountability",
        "subreddit": "r/AnalogCommunity",
        "viral_score": 42,
        "wabi_fit": 3,
        "app_idea": "Film Lab Review Tracker — personal log of lab submissions with quality ratings, turnaround times, and issue documentation.",
        "analysis": "Moderate fit: personal tracking works but the real value would be crowdsourced reviews, which needs a community backend beyond a simple mini app."
    },
    {
        "pain_point": "New Photographer Feedback Loop",
        "subreddit": "r/photocritique",
        "viral_score": 38,
        "wabi_fit": 4,
        "app_idea": "Photo Progress Journal — structured self-critique form (composition, light, story) with before/after comparisons and skill progression tracking over time.",
        "analysis": "Strong fit as a self-assessment and progress tracking tool. Doesn't replace external feedback but builds self-critique skills systematically."
    },
    {
        "pain_point": "Photo Portrait Orientation Preview on Mobile Reddit",
        "subreddit": "r/streetphotography",
        "viral_score": 32,
        "wabi_fit": 1,
        "app_idea": "Portrait Photo Preview Tool — preview how portrait images will display on various social platforms before posting.",
        "analysis": "Poor fit: this is a Reddit platform UX issue that needs to be fixed by Reddit itself. A preview tool has marginal utility and doesn't solve the underlying problem."
    },
]

# Step 3: Add rows in batches
def add_row(db_id, row):
    payload = {
        "parent": {"database_id": db_id},
        "properties": {
            "Pain Point": {
                "title": [{"text": {"content": row["pain_point"]}}]
            },
            "Subreddit": {
                "rich_text": [{"text": {"content": row["subreddit"]}}]
            },
            "Viral Score": {
                "number": row["viral_score"]
            },
            "Wabi Fit (1-5)": {
                "number": row["wabi_fit"]
            },
            "App Idea": {
                "rich_text": [{"text": {"content": row["app_idea"]}}]
            },
            "Analysis": {
                "rich_text": [{"text": {"content": row["analysis"]}}]
            },
        }
    }
    return notion_request("POST", "/pages", payload)

print(f"\nAdding {len(rows)} rows...")
for i, row in enumerate(rows):
    try:
        result = add_row(db_id, row)
        print(f"  [{i+1}/50] ✓ {row['pain_point'][:50]}")
        # Rate limit: pause every 3 rows
        if (i + 1) % 3 == 0:
            time.sleep(0.5)
    except Exception as e:
        print(f"  [{i+1}/50] ✗ {row['pain_point'][:50]} — {e}")
        time.sleep(2)
        # Retry once
        try:
            result = add_row(db_id, row)
            print(f"  [{i+1}/50] ✓ RETRY OK {row['pain_point'][:50]}")
        except Exception as e2:
            print(f"  [{i+1}/50] ✗ RETRY FAILED {row['pain_point'][:50]} — {e2}")

print(f"\n✅ Done! Database ID: {db_id}")
print(f"View at: https://notion.so/{db_id.replace('-', '')}")
