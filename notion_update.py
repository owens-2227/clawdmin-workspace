#!/usr/bin/env python3
"""Update Notion database with detailed app write-ups for 50 pain points."""

import json
import time
import urllib.request
import urllib.error

API_SECRET = "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"
DB_ID = "33066005-ab52-8193-a66d-ea9e3b139f35"
BASE = "https://api.notion.com/v1"
HEADERS = {
    "Authorization": f"Bearer {API_SECRET}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}

def notion_request(method, path, data=None):
    url = f"{BASE}{path}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"ERROR {e.code} on {method} {path}: {err}")
        raise

# Pain point context keyed by viral score + partial title match
WRITEUPS = {
    # We'll match by title content. Build a lookup after querying pages.
}

def generate_writeup(title, subreddit, viral_score, app_idea):
    """Generate the three fields based on pain point context."""
    t = (title or "").lower()
    vs = viral_score or 0
    idea = app_idea or ""
    
    # Match each pain point and return (what_it_does, feature_set, how_it_solves)
    
    if "windfall" in t or ("sudden" in t and "financial" in t):
        return (
            "A step-by-step financial guidance tool for people who've received a sudden large sum of money. Users answer questions about their windfall type, amount, existing debts, and goals to get a personalized action plan with prioritized next steps.",
            "• Windfall type selector (inheritance, settlement, lottery, bonus)\n• Personalized action plan generator based on amount and situation\n• Tax obligation estimator with state-specific considerations\n• Debt vs invest vs save priority calculator\n• Professional advisor checklist (what type of advisor to seek)\n• Common mistakes warning system based on windfall type",
            "Instead of wading through contradictory Reddit threads, users get a single coherent roadmap tailored to their exact situation. The tool cuts through noise by asking the right questions upfront and delivering prioritized steps they can act on immediately."
        )
    
    if "energy" in t and ("efficien" in t or "saving" in t or "hidden" in t):
        return (
            "A home energy audit guide that walks homeowners through identifying their biggest energy waste areas and discovering free or low-cost programs available in their area. Users input their home details and zip code to get prioritized savings recommendations.",
            "• ZIP code-based utility rebate and free audit finder\n• Room-by-room energy waste checklist\n• Priority ranking of fixes by cost vs savings impact\n• Seasonal energy-saving action calendar\n• Estimated annual savings calculator per improvement\n• DIY vs professional recommendation for each fix",
            "Homeowners miss out on thousands in savings because they don't know free energy audits exist or which fixes matter most. This tool surfaces hidden programs and prioritizes improvements so users stop guessing and start saving."
        )
    
    if "night motivation" in t or "morning follow" in t:
        return (
            "A motivation capture-and-delivery tool that helps users lock in their late-night plans and commitments, then delivers them as actionable morning briefings. Users brain-dump their goals at night, and the app restructures them into a simple morning checklist.",
            "• Night-mode brain dump capture with free-text input\n• Automatic restructuring into 3-5 actionable morning tasks\n• Morning delivery via email or bookmark with commitment reminder\n• Friction-reduction tips customized to each task\n• Streak tracker for follow-through rate over time\n• Weekly review of planned vs completed actions",
            "The gap between night motivation and morning action is real — this tool bridges it by capturing energy when it peaks and converting it into friction-free morning actions. Users stop losing their best ideas to sleep."
        )
    
    if "bike" in t and ("city" in t or "afford" in t or "friendly" in t):
        return (
            "A city comparison tool that ranks locations by both cycling infrastructure quality and cost of living. Users set their budget and biking priorities to discover affordable cities where car-free living is actually viable.",
            "• Side-by-side city comparison on bike infrastructure scores\n• Cost of living filter with adjustable budget range\n• Bike lane mileage, bike share availability, and safety stats\n• Climate and terrain suitability ratings\n• Community cycling culture indicators\n• Personalized city shortlist based on weighted preferences",
            "Bike commuters know Portland and Amsterdam are great — but can't afford them. This tool reveals hidden gems where cycling infrastructure meets affordability, giving users real options instead of aspirational ones."
        )
    
    if "adhd" in t and ("hygiene" in t or "habit" in t or "brush" in t or "basic" in t):
        return (
            "An ADHD-adapted hygiene habit tool that uses body-doubling prompts, dopamine-friendly rewards, and shame-free tracking to help users build basic self-care routines. It's designed around how ADHD brains actually work, not neurotypical assumptions.",
            "• Shame-free check-in system (no guilt for missed days)\n• Micro-step task breakdown (stand up → walk to bathroom → pick up toothbrush)\n• Randomized reward messages for dopamine hits\n• Flexible scheduling that adapts to hyperfocus and low-energy days\n• Visual streak tracker with gentle recovery after gaps\n• Routine bundling suggestions to chain habits together",
            "Standard reminder apps fail ADHD users because they ignore executive dysfunction and create shame spirals. This tool meets users where they are — breaking hygiene into micro-steps and celebrating progress without punishing gaps."
        )
    
    if "food safety" in t or ("safety" in t and "cook" in t and "knowledge" not in t) or "kidney bean" in t:
        return (
            "A food safety quick-reference guide that alerts home cooks to hidden dangers in common ingredients before they start cooking. Users search by ingredient to get safety warnings, proper handling instructions, and safe cooking temperatures.",
            "• Ingredient-based safety lookup with instant warnings\n• Dangerous food combination alerts\n• Safe internal temperature reference chart\n• Storage time limits for common leftovers\n• Cross-contamination prevention checklist\n• Quiz mode to test and build food safety knowledge",
            "Most home cooks don't know about dangers like raw kidney bean toxicity or unsafe rice storage until it's too late. This tool proactively surfaces critical safety info at the moment it matters — before cooking, not after a trip to the ER."
        )
    
    if "adhd" in t and ("overwhelm" in t or "work and life" in t or "spiral" in t):
        return (
            "A life triage tool for ADHD users experiencing multi-domain overwhelm across work, home, and relationships. Users identify which areas are in crisis, and the tool generates a minimal viable recovery plan that prevents the failure spiral from cascading further.",
            "• Life domain assessment (work, home, health, relationships, finances)\n• Crisis vs maintenance priority sorter\n• One-thing-per-domain daily action plan\n• Emergency mode with only the most critical tasks\n• Progress visibility across all life areas on one screen\n• Reset protocol for when everything feels broken",
            "When ADHD overwhelm hits multiple life areas simultaneously, generic advice makes it worse. This tool stops the spiral by narrowing focus to one critical action per domain — making recovery feel possible instead of paralyzing."
        )
    
    if "remote" in t and ("social" in t and "isolation" in t or "skill atrophy" in t) and "travel" not in t:
        return (
            "A social fitness tracker for remote workers that helps rebuild social skills through structured micro-challenges and progress tracking. Users work through graduated social exercises — from async messages to video calls to in-person meetups.",
            "• Social skill self-assessment baseline quiz\n• Graduated challenge system (text → call → coffee → group)\n• Weekly social interaction goal setting\n• Conversation starter prompts for rusty socializers\n• Comfort zone expansion tracker with difficulty ratings\n• Reflection journal for post-interaction processing",
            "Remote workers don't just lose social connections — they lose the skills to rebuild them. This tool provides a structured, low-pressure path from isolation back to confident social interaction, one small step at a time."
        )
    
    if "tmj" in t and ("self-help" in t or "knowledge gap" in t or "tongue" in t or "posture" in t):
        return (
            "An interactive TMJ self-care guide that teaches proper jaw positioning, tongue posture, and daily exercises through step-by-step visual instructions. Users learn the fundamentals that many go years without discovering.",
            "• Interactive tongue posture and jaw position tutorials\n• Daily exercise routine with timer and rep counter\n• Symptom-to-exercise matching guide\n• Progress tracker for pain levels over time\n• Trigger identification checklist (stress, posture, diet)\n• Printable quick-reference card for daily habits",
            "TMJ sufferers spend years without learning basic self-help techniques like proper tongue posture because the info is buried in specialist forums. This tool makes that foundational knowledge immediately accessible and actionable."
        )
    
    if "home cook" in t and "technique" in t or ("restaurant" in t and "technique" in t):
        return (
            "A cooking technique encyclopedia that reveals the professional methods restaurants use but rarely share — from pan temperature control to seasoning layers. Users search by dish type to learn the specific techniques that elevate home cooking.",
            "• Technique library organized by cooking method and dish type\n• Side-by-side comparison: home method vs restaurant method\n• Video-free step-by-step visual guides\n• Equipment substitution suggestions for home kitchens\n• Flavor building framework (salt, fat, acid, heat timing)\n• Common mistake diagnosis tool by dish",
            "Home cooks follow the same recipes as professionals but get inferior results because they're missing technique knowledge that chefs take for granted. This tool closes that gap by teaching the 'how' behind the 'what.'"
        )
    
    if "phone addiction" in t or ("beyond" in t and "block" in t):
        return (
            "A phone usage awareness tool that helps users understand the psychological triggers behind their screen time rather than just blocking apps. Users log their phone pickups with context to identify patterns and develop healthier responses.",
            "• Trigger logging system (bored, anxious, lonely, habit)\n• Pattern analysis showing when and why you reach for your phone\n• Alternative action suggestions matched to each trigger\n• Daily awareness score based on intentional vs automatic use\n• Weekly insight reports on usage patterns and progress\n• Mindful phone pickup ritual builder",
            "App blockers treat the symptom, not the cause — users just find workarounds. This tool addresses the underlying psychology by building awareness of triggers, so users make conscious choices instead of fighting willpower battles."
        )
    
    if "solo travel" in t and ("non-drink" in t or "alcohol" in t or "isolation" in t):
        return (
            "A sober-friendly travel activity finder that helps non-drinking solo travelers discover evening social activities that don't revolve around alcohol. Users input their destination to find cafes, game nights, workshops, and cultural events.",
            "• Destination-based sober evening activity database\n• Activity type filters (cultural, social, active, creative)\n• User-submitted venue reviews with 'sober-friendly' ratings\n• Hostel and accommodation social event calendars\n• Conversation starter cards for solo meetups\n• Trip planning mode to pre-plan social activities by city",
            "Travel social life is built around bars and pub crawls, leaving non-drinkers isolated every evening. This tool curates alcohol-free social options so solo travelers can connect without compromising their choices."
        )
    
    if "divorce" in t and "financial" in t:
        return (
            "A divorce financial decision calculator that helps users compare complex asset division scenarios with tax implications. Users input their assets, debts, and income to model different settlement options and see long-term financial impact.",
            "• Asset vs debt inventory builder (house, 401k, debts)\n• Side-by-side settlement scenario comparison\n• Tax implication estimator for each scenario\n• Liquidity analysis (cash flow after each option)\n• Hidden cost identifier (maintenance, insurance, taxes)\n• Decision framework checklist for emotional vs financial factors",
            "Divorce financial decisions involve impossible tradeoffs between house equity, retirement accounts, and tax consequences. This tool lets users model scenarios clearly so they negotiate from understanding, not confusion."
        )
    
    if "baby sleep" in t or ("sleep" in t and "parent" in t and "pattern" in t):
        return (
            "A baby sleep pattern tracker that helps exhausted parents log sleep data and identify what's actually working versus what's just noise. The tool cuts through contradictory advice by showing personalized patterns based on their own baby's data.",
            "• Simple sleep/wake logging with one-tap entries\n• Pattern detection across naps, bedtime, wake windows\n• Variable tracking (feeding, environment, routine changes)\n• Visual charts showing sleep trends over days and weeks\n• Myth vs evidence guide for common sleep advice\n• Age-appropriate sleep expectation benchmarks",
            "Parents get bombarded with contradictory sleep advice while running on zero sleep. This tool replaces opinions with their own baby's data — showing what actually works for their child, not what worked for someone else's."
        )
    
    if "credit card" in t and ("young" in t or "advice" in t or "conflicting" in t or "18" in t) and "debt" not in t:
        return (
            "A credit card basics guide for young adults that cuts through conflicting advice with clear, step-by-step rules. Users answer a few questions about their situation to get personalized guidance on payments, utilization, and credit building.",
            "• Situation-based credit card rule generator\n• Payment timing optimizer (when to pay, how much)\n• Credit utilization calculator with score impact estimates\n• Common myths debunker with source citations\n• First credit card comparison tool for beginners\n• Monthly credit health checklist",
            "Young adults get paralyzed by contradictory credit advice — pay before statement vs after, 30% utilization vs 0%. This tool gives clear, personalized rules based on their actual situation, eliminating confusion and building confidence."
        )
    
    if "procrastinat" in t and "perfecti" in t:
        return (
            "A perfectionism-to-action converter that helps chronic procrastinators break the 'waiting for the right moment' cycle. Users identify their stalled projects and get structured micro-commitments designed to bypass perfectionist resistance.",
            "• Stalled project inventory with 'days waiting' counter\n• Perfectionism pattern identifier (which fears drive delay)\n• 5-minute micro-commitment generator per project\n• 'Good enough' criteria definer to set realistic standards\n• Progress photo/note journal to build momentum\n• Weekly momentum review with celebration prompts",
            "Perfectionism disguises itself as preparation — but years pass while waiting for the 'right time.' This tool breaks the loop by making the first step so small that perfectionism can't object, building momentum through action instead of planning."
        )
    
    if "film scan" in t or ("scanning" in t and "equipment" in t):
        return (
            "A film scanning setup advisor that matches users' existing camera gear to viable DIY scanning configurations. Users input their camera body and lenses to get step-by-step instructions for scanning film without expensive dedicated equipment.",
            "• Camera and lens compatibility checker for DSLR scanning\n• Required accessories list with budget options\n• Step-by-step scanning setup guide per equipment combo\n• Light source and film holder recommendations\n• Resolution and quality comparison across methods\n• Software workflow guide for negative conversion",
            "Analog photographers often own cameras capable of excellent film scanning but don't realize it. This tool matches their existing gear to a scanning workflow, eliminating the need for expensive dedicated scanners."
        )
    
    if "film defect" in t or ("diagnos" in t and "film" in t and "light leak" in t):
        return (
            "A film defect diagnosis tool that helps analog photographers identify issues like light leaks, halos, and soft focus from their scan results. Users describe or compare their defect to visual examples to get a diagnosis and prevention steps.",
            "• Visual defect comparison gallery (light leaks, scratches, halos)\n• Symptom-based diagnosis flow (where on frame, pattern, color)\n• Cause identification (camera, development, scanning)\n• Fix and prevention guide for each defect type\n• Camera-specific known issues database\n• Troubleshooting checklist before shooting next roll",
            "Film photographers currently have to shoot another roll just to test if they fixed an unknown problem. This tool diagnoses defects from existing images, saving time, money, and the frustration of guessing."
        )
    
    if "wfh" in t and "time" in t or "time perception" in t:
        return (
            "A time perception and progress tracker for remote workers that creates meaningful markers in the blur of WFH days. Users log daily highlights and the tool generates weekly and monthly retrospectives showing tangible progress and life events.",
            "• Daily one-line highlight capture (takes 10 seconds)\n• Auto-generated weekly summary with accomplishments\n• Monthly retrospective with visual timeline\n• Season and milestone markers to anchor time\n• Life category balance view (work, personal, social, health)\n• Shareable progress snapshots for self-reflection",
            "Remote workers lose all sense of time passing — months blur into sameness. This tool creates temporal anchors through micro-logging, giving users proof that time is moving and they're making progress."
        )
    
    if "post-death" in t or ("death" in t and "medical bill" in t) or ("deceased" in t and "bill" in t):
        return (
            "A step-by-step guide for managing medical bills after a family member's death. Users answer questions about the deceased's situation to get a prioritized action plan covering what to pay, what to dispute, and what the estate actually owes.",
            "• Situation assessment questionnaire (estate, insurance, state)\n• Bill priority sorter (what's owed vs what's not your responsibility)\n• Template letters for disputing and negotiating bills\n• State-specific estate liability guide\n• Timeline tracker for billing deadlines and statute limits\n• Professional referral checklist (estate attorney, executor duties)",
            "Grieving families get pressured into paying bills they may not legally owe. This tool provides clear, compassionate guidance on what to pay, what to fight, and what to ignore — reducing financial harm during an already devastating time."
        )
    
    if "cyclist" in t and ("accountab" in t or "fatal" in t or "accident" in t or "incident" in t):
        return (
            "An incident documentation tool for cyclists that creates legally structured reports of dangerous encounters and accidents. Users fill out a guided form to capture critical details in a format useful for police reports, insurance claims, and advocacy.",
            "• Guided incident report form with legally relevant fields\n• Photo and location documentation prompts\n• Witness information capture template\n• Exportable PDF report for police and insurance\n• Incident pattern tracker for repeat locations\n• Local advocacy group and legal resource directory",
            "After cycling incidents, critical details get lost because there's no structured way to document them in the moment. This tool ensures every legally relevant detail is captured systematically, strengthening accountability efforts."
        )
    
    if "travel alert" in t or ("real-time" in t and "travel" in t and "itinerary" in t):
        return (
            "A travel disruption checker that aggregates regional alerts, safety updates, and transport disruptions for travelers' planned destinations. Users input their itinerary to get a single dashboard of everything that might affect their trip.",
            "• Destination-based disruption alert aggregator\n• Itinerary timeline with risk flags per leg of trip\n• Transport strike and closure tracking\n• Weather disruption forecasts for travel dates\n• Alternative route and backup plan suggestions\n• Shareable trip status page for family back home",
            "Solo travelers currently have to check dozens of sources for disruption info — embassy sites, airline pages, local news. This tool centralizes everything into one itinerary-aware dashboard so nothing catches them off guard."
        )
    
    if "conflicting medical" in t or ("medical advice" in t and "parent" in t):
        return (
            "A medical advice tracker for new parents that logs recommendations from different providers and flags contradictions. Users input advice from their pediatrician, nurses, and specialists to see where guidance conflicts and what questions to ask.",
            "• Provider-by-provider advice log with date and context\n• Automatic contradiction detection across providers\n• Topic-based view (feeding, sleep, vaccines, milestones)\n• Question generator for next appointment based on conflicts\n• Evidence-based reference links for common topics\n• Shareable summary for partner or co-parent alignment",
            "New parents get different instructions from every provider they see, with no way to reconcile them. This tool makes contradictions visible and generates smart questions, turning confusion into productive doctor conversations."
        )
    
    if "language" in t and ("conversation" in t or "fail real" in t or "duolingo" in t):
        return (
            "A conversation readiness assessment tool that tests real-world language skills beyond what apps like Duolingo measure. Users take scenario-based challenges to identify gaps between their app progress and actual conversational ability.",
            "• Scenario-based conversation challenges (ordering food, asking directions)\n• Gap analysis between textbook knowledge and real usage\n• Common phrase and filler word reference by language\n• Cultural context guide for conversational norms\n• Pronunciation self-check exercises\n• Graduated difficulty levels from tourist to conversational",
            "Language app users are shocked when they can't hold a basic conversation despite months of lessons. This tool exposes the real gaps and focuses practice on the practical phrases and patterns actual conversations require."
        )
    
    if "chronic insomnia" in t or ("insomnia" in t and "medical path" in t) or ("insomnia" in t and "effective" in t and "doctor" in t):
        return (
            "A sleep treatment navigator that helps chronic insomnia sufferers understand their options beyond medication cycling. Users assess their history to get a personalized treatment exploration plan including CBT-i readiness assessment.",
            "• Sleep history assessment (duration, treatments tried, patterns)\n• Treatment option explorer (CBT-i, medication, lifestyle, combined)\n• CBT-i readiness self-assessment and local provider finder\n• Doctor conversation preparation guide with key questions\n• Treatment tracking log for current approach effectiveness\n• Root cause exploration checklist (stress, pain, habits, conditions)",
            "Insomnia patients bounce between medications for years because doctors rarely discuss CBT-i or investigate root causes. This tool educates users on all options and prepares them to advocate for comprehensive treatment."
        )
    
    if "credit card debt" in t or ("debt" in t and "escape" in t and "plan" in t):
        return (
            "A personalized debt payoff planner that creates realistic repayment strategies for people on tight budgets. Users input their debts, income, and fixed expenses to get an optimized payoff plan that actually fits their financial reality.",
            "• Debt inventory builder with balances, rates, and minimums\n• Income and expense analyzer to find realistic payoff capacity\n• Avalanche vs snowball strategy comparison with timelines\n• Custom payoff calendar with monthly targets\n• Progress tracker with milestone celebrations\n• Emergency adjustment mode when income changes",
            "Generic debt advice assumes extra money exists. This tool works within real budget constraints, showing users the fastest realistic path out of debt and adapting when life throws curveballs."
        )
    
    if "strength" in t and "running" in t or ("training" in t and "running" in t and "balance" in t and "load" not in t):
        return (
            "A dual-goal fitness periodization planner that helps users balance strength training and running without one undermining the other. Users input their goals and schedule to get a structured training plan with smart phase cycling.",
            "• Goal priority assessment (strength focus vs running focus vs balanced)\n• Weekly schedule builder with recovery optimization\n• Periodization cycle planner (build, peak, maintain phases)\n• Conflict detection (heavy leg day before long run warning)\n• Fatigue and recovery tracker\n• Nutrition timing guidance for competing energy demands",
            "Runners who lift and lifters who run constantly undermine their own progress because each goal fights the other for recovery. This tool structures training phases so both goals advance without destructive interference."
        )
    
    if "mindfulness" in t and "adhd" in t:
        return (
            "An ADHD-adapted mindfulness tool that replaces long meditation sessions with micro-moments of awareness designed for restless brains. Users get 30-second to 2-minute exercises that work with ADHD tendencies instead of against them.",
            "• Ultra-short guided exercises (30 seconds to 2 minutes)\n• Movement-based mindfulness options (not just sitting still)\n• Sensory grounding exercises for ADHD overwhelm\n• Random prompt delivery to catch users in the moment\n• No streak pressure or guilt mechanics\n• Fidget-friendly techniques that channel restlessness",
            "Standard mindfulness apps demand 10+ minutes of stillness — impossible for most ADHD users. This tool brings mindfulness into ADHD reality with micro-exercises that use movement and sensory input, making calm accessible."
        )
    
    if "kids reading" in t or ("reading habit" in t and ("child" in t or "kid" in t or "mommit" in t)):
        return (
            "A family reading habit builder that helps parents track their kids' reading progress, discover age-appropriate books, and maintain motivation through streaks and rewards. It makes reading feel like an adventure, not a chore.",
            "• Reading log with time and book tracking per child\n• Age and interest-based book recommendation engine\n• Reading streak tracker with milestone rewards\n• Family reading challenge mode\n• Library list generator for next library visit\n• Progress visualization that kids enjoy checking",
            "Parents struggle to maintain consistent reading habits for their kids because there's no system connecting tracking, discovery, and motivation. This tool ties all three together so reading becomes a self-reinforcing family habit."
        )
    
    if "video" in t and "podcast" in t or "knowledge retention" in t:
        return (
            "A content retention tool that helps users capture and review key insights from videos and podcasts without breaking their flow. Users log what they're watching and get prompted with spaced-repetition review of key takeaways.",
            "• Quick capture mode for logging insights during content\n• Post-content summary prompt (3 key takeaways in 30 seconds)\n• Spaced repetition review of past captures\n• Topic tagging and searchable insight library\n• Weekly knowledge digest email\n• Connection finder linking related insights across content",
            "People consume hours of podcasts and videos but retain almost nothing. This tool creates a lightweight capture-and-review loop so valuable insights actually stick instead of evaporating after the episode ends."
        )
    
    if "hostel" in t and "social" in t:
        return (
            "A hostel social atmosphere evaluator that aggregates social indicators to help solo travelers find hostels where they'll actually meet people. Users filter by social features to book hostels that match their vibe.",
            "• Social atmosphere scoring based on traveler reviews\n• Social feature checklist (common room, events, bar, kitchen)\n• Solo traveler friendliness ratings\n• Recent social event calendar from hostel\n• Room type impact on socializing (dorm vs private)\n• Destination-based hostel social ranking",
            "Solo travelers book hostels hoping to meet people but often end up in quiet, transit-style accommodations. This tool surfaces the social hostels by aggregating the signals that actually predict a social atmosphere."
        )
    
    if "language exchange" in t and "safety" in t:
        return (
            "A safety-focused language exchange matching guide that helps users find vetted conversation partners while avoiding predatory behavior common on existing platforms. Users get a safety checklist and platform comparison for protected practice.",
            "• Language exchange platform safety comparison chart\n• Red flag identification guide for unsafe interactions\n• Safety checklist for first video/voice exchanges\n• Structured session templates to keep exchanges focused\n• Reporting and blocking best practices\n• Alternative community recommendations with moderation",
            "Language exchange apps are plagued by users with non-language motives, making learners — especially women — feel unsafe. This tool helps users identify safe platforms and set boundaries that keep practice focused and protected."
        )
    
    if "tmj" in t and ("treatment" in t and "confusion" in t or "crowdsource" in t):
        return (
            "A TMJ treatment outcome tracker that helps patients compare treatment experiences and make informed decisions about costly therapies. Users browse anonymized outcome data and log their own treatment journey to help others.",
            "• Treatment option database with patient-reported outcomes\n• Cost vs effectiveness comparison by treatment type\n• Personal treatment timeline tracker\n• Provider review system with treatment-specific ratings\n• Symptom improvement scoring pre and post treatment\n• Decision framework for choosing next treatment step",
            "TMJ patients spend thousands on treatments with no idea if they work for people with similar symptoms. This tool crowdsources real outcome data so patients make informed decisions instead of expensive blind guesses."
        )
    
    if ("early morning" in t and "wake" in t) or ("3am" in t) or ("wake cycle" in t and "protocol" not in t):
        return (
            "A structured sleep protocol for people stuck in the 3am wake cycle. Users track their wake patterns and get personalized techniques drawn from sleep science to gradually shift their wake time back to morning.",
            "• Wake time pattern logger with contributing factor tracking\n• Personalized protocol generator based on wake pattern\n• Stimulus control technique guide for middle-of-night waking\n• Sleep window adjustment calculator\n• Relaxation technique library for 3am wake moments\n• Progress tracker showing wake time trends over weeks",
            "The 3am wake pattern is a specific insomnia subtype that generic sleep advice doesn't address. This tool provides targeted protocols for middle-of-night insomnia, giving users a structured path instead of random tips."
        )
    
    if "running" in t and "training load" in t or ("garmin" in t and "running" in t):
        return (
            "A plain-language running training load interpreter that translates Garmin and fitness tracker numbers into actionable guidance. Users input their stats to get clear recommendations on whether to push harder, maintain, or rest.",
            "• Training load number translator (what your score actually means)\n• Plain-language daily recommendation (push, maintain, rest)\n• Weekly volume trend analysis with overtraining warnings\n• Race readiness estimator based on recent training\n• Recovery day suggestions with active recovery options\n• Effort distribution guide (easy vs hard day balance)",
            "Garmin throws numbers at runners without explaining what to do with them. This tool translates training load data into clear, actionable daily decisions — run hard, run easy, or rest — in language anyone can understand."
        )
    
    if "adhd" in t and ("declutter" in t or "clutter" in t):
        return (
            "An ADHD-adapted decluttering guide that breaks the buy-clutter-overwhelm cycle with dopamine-friendly sorting methods and decision frameworks. Users work through small, timed sessions designed to prevent the paralysis standard methods cause.",
            "• 10-minute timed declutter sessions (no marathon cleaning)\n• ADHD decision framework (keep/toss/donate without overthinking)\n• One-category-at-a-time method to prevent overwhelm\n• Visual progress tracker with before/after motivation\n• Impulse purchase reflection tool to prevent re-cluttering\n• Maintenance mode with weekly micro-declutter reminders",
            "Standard decluttering methods like KonMari overwhelm ADHD brains with too many decisions at once. This tool works with ADHD by using time-boxed sessions, simple binary choices, and visual progress to make decluttering actually achievable."
        )
    
    if "sleep med" in t or ("tapering" in t and "sleep" in t) or ("dependency" in t and "sleep" in t):
        return (
            "A sleep medication tapering guide that helps users create a structured, gradual reduction plan to discuss with their doctor. Users input their current medication and dosage to get a sample tapering timeline and symptom tracking tools.",
            "• Current medication and dosage assessment\n• Sample tapering schedule generator (for doctor discussion)\n• Withdrawal symptom tracker and severity logger\n• Non-medication sleep support techniques per taper phase\n• Doctor conversation preparation guide\n• Emergency protocol for severe withdrawal symptoms",
            "Users attempt dangerous self-tapering because no accessible tool exists for structured reduction plans. This tool creates a sample taper schedule they can bring to their doctor, replacing risky guesswork with informed medical conversations."
        )
    
    if "diabetic cat" in t and ("onboard" in t or "new" in t or "owner" in t) and "insulin" not in t:
        return (
            "An onboarding guide for new diabetic cat owners that walks through glucose monitoring, insulin dosing basics, and daily care routines. Users get a structured learning path that replaces panicked Googling with step-by-step confidence building.",
            "• Day-by-day onboarding curriculum for new diabetic cat owners\n• Glucose target range explainer with visual guides\n• Blood testing technique walkthrough with fear reduction tips\n• Insulin dosing basics and safety rules\n• Daily care routine builder and checklist\n• Emergency signs reference card (when to call the vet)",
            "New diabetic cat owners are overwhelmed by conflicting glucose targets and terrified of hurting their cat with needles. This tool provides a calm, structured onboarding path so they can care for their pet with confidence instead of panic."
        )
    
    if "ai image" in t and "garden" in t or ("pollut" in t and "garden" in t):
        return (
            "A curated garden inspiration gallery that verifies and showcases only real photos from actual gardeners. Users browse authentic gardens by style, region, and season — an AI-free alternative to Pinterest's polluted image feeds.",
            "• Verified real garden photo gallery (no AI images)\n• Filter by garden style, climate zone, and season\n• Plant identification on submitted photos\n• Community submissions with verification process\n• Inspiration boards for planning your own garden\n• Regional planting guides linked to garden photos",
            "Gardeners can't trust Pinterest or Facebook anymore — 90% of 'garden inspiration' is AI-generated fantasy. This tool curates only verified real garden photos, giving users authentic inspiration they can actually replicate."
        )
    
    if "remote" in t and ("context loss" in t or "team context" in t or "alignment" in t):
        return (
            "A team context preservation tool that helps remote teams maintain shared understanding across async communication channels. Teams use structured update templates to capture decisions, context, and rationale in a searchable format.",
            "• Structured decision log template with context and rationale\n• Project context summary generator from meeting notes\n• New team member context packet builder\n• Cross-channel information tracker (Slack, email, docs)\n• Weekly alignment checkpoint template\n• Context gap detector for under-documented decisions",
            "Remote teams lose critical context every time information passes through another channel or meeting. This tool captures the 'why' behind decisions in a structured, searchable format so alignment doesn't erode with each async handoff."
        )
    
    if "bike repair" in t or ("compatibility" in t and "bike" in t and "diy" in t) or "bikewrench" in t:
        return (
            "A bike parts compatibility checker and repair guide that helps home mechanics navigate the confusing world of bicycle standards. Users input their bike details to get compatibility info, required tools, and step-by-step repair guides.",
            "• Bike component compatibility checker by model/year\n• Required tools list for each repair type\n• Step-by-step repair guides with difficulty ratings\n• Common compatibility pitfalls and workarounds\n• Budget tool recommendation for home mechanics\n• Repair complexity estimator (DIY vs shop recommendation)",
            "Home bike repair fails when parts don't fit and the right tool is missing. This tool pre-checks compatibility and tool requirements before users buy anything, preventing wasted money and frustrating garage sessions."
        )
    
    if "tmj" in t and ("cascad" in t or "symptom" in t or "tracker" in t or "unified" in t):
        return (
            "A TMJ symptom tracker that maps the web of connected symptoms — jaw pain, headaches, ear ringing, neck tension — and generates reports for specialists. Users log daily symptoms to visualize patterns and correlations.",
            "• Multi-symptom daily tracker (jaw, head, ear, neck, sleep)\n• Symptom correlation visualization over time\n• Trigger identification analysis (food, stress, posture, weather)\n• Specialist-ready report generator (PDF export)\n• Treatment response tracking per symptom\n• Cross-specialist communication summary",
            "TMJ causes cascading symptoms across multiple body systems that no single specialist sees fully. This tool tracks everything in one place and generates unified reports so specialists finally see the complete picture."
        )
    
    if "insulin" in t and "cat" in t or ("affordable" in t and "insulin" in t):
        return (
            "A diabetic cat insulin cost comparison tool that aggregates discount sources, compounding pharmacies, and assistance programs. Users input their cat's insulin type to find the cheapest legitimate sources and save hundreds per year.",
            "• Insulin type and brand cost comparison database\n• Discount pharmacy and compounding pharmacy finder\n• Manufacturer assistance program eligibility checker\n• Community-sourced price reports with verification dates\n• Cost calculator for different sourcing strategies\n• Savings tracker showing money saved over time",
            "Diabetic cat owners spend hundreds monthly on insulin while cheaper legitimate sources hide in buried Reddit comments and Facebook groups. This tool surfaces every discount option in one place so cost never forces owners to compromise care."
        )
    
    if "film" in t and ("travel" in t or "x-ray" in t or "airport" in t):
        return (
            "An airport film safety guide that provides scanner policies by country and recommendations based on film ISO. Travelers input their itinerary and film stock to get specific guidance on protecting their film through each airport.",
            "• Country-by-country airport scanner policy database\n• Film ISO-based risk assessment per scanner type\n• Hand-check request phrase guide in multiple languages\n• Packing recommendations for film protection\n• Airport-specific tips from traveler reports\n• Pre-trip checklist for analog photographers",
            "Analog photographers traveling with film stress about X-ray damage but can't find centralized scanner policy info. This tool gives per-airport, per-film-speed guidance so photographers travel confidently instead of anxiously."
        )
    
    if "bike light" in t or ("charging" in t and "bike" in t and "forget" in t):
        return (
            "A bike maintenance reminder tool that tracks charging cycles, tire pressure schedules, and chain lube intervals. Users set up their bike components and get timely reminders so nothing gets forgotten between rides.",
            "• Component-based maintenance schedule builder\n• Light charging reminder based on ride frequency\n• Tire pressure check interval tracker\n• Chain lube and drivetrain maintenance alerts\n• Pre-ride checklist generator\n• Maintenance log with component lifespan tracking",
            "Cyclists forget to charge lights and check tire pressure because there's no system connecting maintenance to ride schedules. This tool sends the right reminders at the right time so safety-critical maintenance never slips."
        )
    
    if "post-viral" in t or ("covid" in t and "insomnia" in t) or ("viral" in t and "insomnia" in t):
        return (
            "A post-viral insomnia onset tracker that helps users document their sleep disruption timeline relative to illness for medical consultations. Users log symptoms and patterns to build an evidence-based case for their doctor.",
            "• Illness-to-insomnia timeline builder\n• Symptom onset and progression logger\n• Sleep pattern change documentation vs pre-illness baseline\n• Doctor visit preparation summary generator\n• Post-viral insomnia specific information guide\n• Treatment response tracker for prescribed interventions",
            "Post-COVID insomnia is a distinct pattern that doctors may not recognize without clear documentation. This tool helps users build a compelling timeline connecting their illness to sleep disruption, enabling better medical advocacy."
        )
    
    if "multi-modal" in t or ("commute" in t and "bag" in t) or ("pannier" in t):
        return (
            "A commute bag configuration advisor for multi-modal travelers who combine biking with public transit. Users input their commute details to get recommendations on bag type, mounting, and organization for seamless mode switching.",
            "• Commute profile builder (distances, modes, carry items)\n• Pannier vs backpack comparison for specific commute types\n• Quick-release and mounting system recommendations\n• Packing organization guide for mode transitions\n• Weather protection and waterproofing advice\n• Budget-tiered gear recommendations",
            "Bike-to-train commuters struggle with the pannier-to-backpack dilemma because no tool considers the full multi-modal journey. This advisor recommends the optimal bag setup for seamless transitions between bike and transit."
        )
    
    if "film lab" in t or ("lab reliability" in t):
        return (
            "A film lab quality tracker where analog photographers can log development results and compare lab reliability over time. Users rate their lab experiences to build a personal quality history and discover better alternatives.",
            "• Lab experience logger with quality rating system\n• Development consistency tracker per lab over time\n• Issue reporting system (scratches, color shift, lost rolls)\n• Lab comparison tool by service type and location\n• Community quality scores for popular labs\n• Lab communication templates for reporting defects",
            "Film photographers have no way to track whether their lab's quality is consistent or declining. This tool creates accountability through structured logging and community data, helping users find labs they can trust."
        )
    
    if "photographer feedback" in t or ("feedback loop" in t and "photo" in t) or "photocritique" in t:
        return (
            "A structured photography improvement tracker that helps new photographers get consistent feedback and measure their progress over time. Users upload photos with specific technique goals to get focused critique areas and track skill development.",
            "• Photo submission with technique focus tags\n• Self-assessment rubric for composition, exposure, storytelling\n• Progress tracking across defined skill areas over time\n• Structured critique request template for communities\n• Before/after comparison for technique improvement\n• Monthly skill review with targeted practice suggestions",
            "New photographers post in critique forums but get inconsistent, unhelpful feedback with no way to track growth. This tool structures the improvement process with clear metrics and focused practice areas so progress becomes visible."
        )
    
    if "portrait preview" in t or ("crop" in t and "reddit" in t and "photo" in t) or "streetphotography" in t:
        return (
            "A photo format preview tool that shows photographers how their images will appear when cropped by various social media platforms. Users upload portrait photos to see Reddit, Instagram, and Twitter crop previews before posting.",
            "• Multi-platform crop preview (Reddit, Instagram, Twitter)\n• Portrait vs landscape display simulation\n• Composition adjustment suggestions for each platform\n• Optimal resolution and aspect ratio guide per platform\n• Side-by-side original vs cropped comparison\n• Best posting practices guide for vertical photos",
            "Street photographers avoid sharing portrait-oriented work on Reddit because aggressive cropping ruins their compositions. This tool previews exactly how each platform will display their images, enabling informed posting decisions."
        )
    
    # Fallback
    return (
        f"A lightweight web tool that addresses the core frustration described in this pain point. Users interact with a simple, guided interface to get personalized recommendations and actionable next steps tailored to their specific situation.",
        f"• Guided questionnaire to assess user's specific situation\n• Personalized recommendation engine\n• Action step checklist with priority ordering\n• Progress tracking dashboard\n• Resource library with vetted references\n• Shareable results summary",
        f"This tool directly addresses the pain point by replacing scattered, conflicting advice with a single structured resource. Users get clarity and actionable guidance instead of information overload."
    )


def get_title(page):
    """Extract title from page properties."""
    for prop_name, prop_val in page.get("properties", {}).items():
        if prop_val.get("type") == "title":
            parts = prop_val.get("title", [])
            return "".join(p.get("plain_text", "") for p in parts)
    return ""

def get_rich_text(page, prop_name):
    """Extract rich text value."""
    prop = page.get("properties", {}).get(prop_name, {})
    parts = prop.get("rich_text", [])
    return "".join(p.get("plain_text", "") for p in parts)

def get_select(page, prop_name):
    prop = page.get("properties", {}).get(prop_name, {})
    sel = prop.get("select")
    if sel:
        return sel.get("name", "")
    return ""

def get_number(page, prop_name):
    prop = page.get("properties", {}).get(prop_name, {})
    return prop.get("number")


def main():
    # Step 1: Add three new properties to database schema
    print("Step 1: Adding new properties to database schema...")
    schema_update = {
        "properties": {
            "What It Does": {"rich_text": {}},
            "Feature Set": {"rich_text": {}},
            "How It Solves the Pain": {"rich_text": {}}
        }
    }
    try:
        result = notion_request("PATCH", f"/databases/{DB_ID}", schema_update)
        print("Schema updated successfully!")
    except Exception as e:
        print(f"Schema update may have failed (properties might already exist): {e}")
    
    time.sleep(1)
    
    # Step 2: Query all pages
    print("\nStep 2: Querying all pages from database...")
    all_pages = []
    has_more = True
    start_cursor = None
    
    while has_more:
        query_data = {"page_size": 100}
        if start_cursor:
            query_data["start_cursor"] = start_cursor
        result = notion_request("POST", f"/databases/{DB_ID}/query", query_data)
        all_pages.extend(result.get("results", []))
        has_more = result.get("has_more", False)
        start_cursor = result.get("next_cursor")
        time.sleep(0.5)
    
    print(f"Found {len(all_pages)} pages")
    
    # Step 3 & 4: Read each page and generate writeups
    print("\nStep 3-4: Reading pages and generating writeups...")
    updates = []
    for page in all_pages:
        page_id = page["id"]
        title = get_title(page)
        
        # Try to find subreddit and viral score from various property names
        props = page.get("properties", {})
        subreddit = ""
        viral_score = None
        app_idea = ""
        
        for pname, pval in props.items():
            ptype = pval.get("type", "")
            pl = pname.lower()
            if "subreddit" in pl and ptype == "select":
                subreddit = get_select(page, pname)
            elif "subreddit" in pl and ptype == "rich_text":
                subreddit = get_rich_text(page, pname)
            elif ("viral" in pl or "score" in pl) and ptype == "number":
                viral_score = get_number(page, pname)
            elif ("app" in pl or "idea" in pl) and ptype == "rich_text":
                app_idea = get_rich_text(page, pname)
            elif ("app" in pl or "idea" in pl) and ptype == "title":
                pass  # title already captured
        
        what_it_does, feature_set, how_it_solves = generate_writeup(title, subreddit, viral_score, app_idea)
        
        updates.append({
            "page_id": page_id,
            "title": title,
            "what_it_does": what_it_does,
            "feature_set": feature_set,
            "how_it_solves": how_it_solves,
        })
        print(f"  Prepared: {title[:60]}...")
    
    # Step 5 & 6: Batch update pages
    print(f"\nStep 5-6: Updating {len(updates)} pages in batches of 5...")
    success_count = 0
    fail_count = 0
    
    for i, update in enumerate(updates):
        page_id = update["page_id"]
        try:
            patch_data = {
                "properties": {
                    "What It Does": {
                        "rich_text": [{"text": {"content": update["what_it_does"][:2000]}}]
                    },
                    "Feature Set": {
                        "rich_text": [{"text": {"content": update["feature_set"][:2000]}}]
                    },
                    "How It Solves the Pain": {
                        "rich_text": [{"text": {"content": update["how_it_solves"][:2000]}}]
                    }
                }
            }
            notion_request("PATCH", f"/pages/{page_id}", patch_data)
            success_count += 1
            print(f"  [{success_count}/{len(updates)}] Updated: {update['title'][:50]}...")
        except Exception as e:
            fail_count += 1
            print(f"  FAILED: {update['title'][:50]}... - {e}")
        
        # Rate limit: pause every 5 updates
        if (i + 1) % 5 == 0:
            print(f"  (Pausing 2s for rate limiting...)")
            time.sleep(2)
        else:
            time.sleep(0.5)
    
    print(f"\n{'='*50}")
    print(f"DONE! Successfully updated: {success_count}/{len(updates)}")
    if fail_count:
        print(f"Failed: {fail_count}")

if __name__ == "__main__":
    main()
