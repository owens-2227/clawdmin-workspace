#!/bin/bash
# Premium Account Warming Runner v1 — 2026-04-17
# Opens AdsPower premium profiles, runs warm-premium.py per account, closes profiles.
#
# Usage: ./run-premium-warming.sh [--accounts "reddit-23-premium,reddit-24-premium"] [--timeout 3300]
#
# Reads from premium-state.json. Only warms accounts with status != suspended/shadowbanned/paused.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="$HOME/.openclaw/workspace/BRAIN/warming/premium-state.json"
LOG_DIR="$HOME/.openclaw/workspace/BRAIN/warming/logs/premium"
WARM_PY="$SCRIPT_DIR/warm-premium.py"

ADS_API="http://127.0.0.1:50325/api/v1"
ADS_AUTH="Bearer 0d599e9255deef1bcc503d735da537160085c443c76f1c30"

TIMEOUT=3300  # 55 minutes (45 min session + 10 min buffer)
FILTER_ACCOUNTS=""

# Parse args
while [[ $# -gt 0 ]]; do
    case $1 in
        --timeout) TIMEOUT="$2"; shift 2 ;;
        --accounts) FILTER_ACCOUNTS="$2"; shift 2 ;;
        *) shift ;;
    esac
done

mkdir -p "$LOG_DIR"

DATE=$(date +%Y-%m-%d)
TIME=$(date +%H%M)
SESSION_LOG="$LOG_DIR/warming-${DATE}-${TIME}.json"

echo "═══════════════════════════════════════════════════════════"
echo "⭐ Premium Account Warming — $(date '+%Y-%m-%d %H:%M %Z')"
echo "═══════════════════════════════════════════════════════════"

if [ ! -f "$STATE_FILE" ]; then
    echo "❌ No premium-state.json found at $STATE_FILE"
    exit 1
fi

# Get active accounts
ACCOUNTS=$(python3 -c "
import json
filter_names = '${FILTER_ACCOUNTS}'.split(',') if '${FILTER_ACCOUNTS}' else []
filter_names = [n.strip() for n in filter_names if n.strip()]

with open('$STATE_FILE') as f:
    state = json.load(f)

active = []
for name, acct in state.get('accounts', {}).items():
    if acct.get('status') in ('shadowbanned', 'suspended', 'paused'):
        continue
    if filter_names and name not in filter_names:
        continue
    active.append(json.dumps({
        'name': name,
        'user_id': acct['user_id'],
        'username': acct['reddit_username'],
        'phase': acct['current_phase'],
        'subreddits': ','.join(acct.get('subreddits', [])),
    }))
print('|||'.join(active))
")

if [ -z "$ACCOUNTS" ]; then
    echo "⚠️  No active premium accounts found"
    echo '{"timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","accounts_run":0,"results":[]}' > "$SESSION_LOG"
    exit 0
fi

IFS='|||' read -ra ACCT_LIST <<< "$ACCOUNTS"
echo "📋 Found ${#ACCT_LIST[@]} premium accounts to warm"

RESULTS=()
RESULTS_FILE=$(mktemp /tmp/premium-warming-results.XXXXXX)
SUCCESS_COUNT=0
FAIL_COUNT=0

for acct_json in "${ACCT_LIST[@]}"; do
    NAME=$(echo "$acct_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['name'])")
    USER_ID=$(echo "$acct_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['user_id'])")
    USERNAME=$(echo "$acct_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['username'])")
    PHASE=$(echo "$acct_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['phase'])")
    SUBS=$(echo "$acct_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['subreddits'])")

    echo "────────────────────────────────────────"
    echo "⭐ $NAME ($USERNAME, phase $PHASE)"

    # Enforce session-per-day cap (max 2 during Phase 1-2, max 3 during Phase 3)
    MAX_SESSIONS_TODAY=3
    if [ "$PHASE" -le 2 ]; then
        MAX_SESSIONS_TODAY=2
    fi
    
    SESSIONS_TODAY=$(python3 -c "
import json
from datetime import date
with open('$STATE_FILE') as f:
    state = json.load(f)
acct = state.get('accounts', {}).get('$NAME', {})
today = date.today().isoformat()
count = sum(1 for s in acct.get('sessions', []) if s.get('date', '')[:10] == today and s.get('success'))
print(count)
")
    
    if [ "$SESSIONS_TODAY" -ge "$MAX_SESSIONS_TODAY" ]; then
        echo "  ⏭️  Skipping — already ran $SESSIONS_TODAY sessions today (max $MAX_SESSIONS_TODAY for phase $PHASE)"
        continue
    fi

    # Open AdsPower profile
    echo "  🌐 Opening AdsPower profile..."
    ADS_RESP=$(curl -s "$ADS_API/browser/start?user_id=$USER_ID" -H "Authorization: $ADS_AUTH" 2>/dev/null || echo '{"code":-1}')
    CDP_URL=$(echo "$ADS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('ws',{}).get('puppeteer',''))" 2>/dev/null || echo "")

    if [ -z "$CDP_URL" ]; then
        echo "  ❌ Failed to get CDP URL"
        FAIL_COUNT=$((FAIL_COUNT + 1))
        NO_CDP_RESULT="{\"username\":\"$USERNAME\",\"success\":false,\"error\":\"no_cdp_url\"}"
        RESULTS+=("$NO_CDP_RESULT")
        echo "$NO_CDP_RESULT" >> "$RESULTS_FILE"
        continue
    fi

    echo "  🔗 CDP: ${CDP_URL:0:50}..."
    sleep 3

    # Check for comment plan
    COMMENT_PLAN_ARG=""
    COMMENT_PLAN_FILE="$LOG_DIR/${NAME}-comment-plan.json"
    if [ "$PHASE" -ge 2 ] && [ -f "$COMMENT_PLAN_FILE" ]; then
        COMMENT_PLAN_ARG="--comment-plan $COMMENT_PLAN_FILE"
        echo "  💬 Comment plan found for Phase $PHASE"
    fi

    # Run warm-premium.py
    echo "  🏃 Running warm-premium.py (phase $PHASE, timeout ${TIMEOUT}s)..."
    ACCT_LOG="$LOG_DIR/${NAME}-${DATE}-${TIME}.json"

    WARM_OUTPUT=$(perl -e "alarm $TIMEOUT; exec @ARGV" python3 "$WARM_PY" "$CDP_URL" "$USERNAME" "$PHASE" --subreddits "$SUBS" $COMMENT_PLAN_ARG 2>&1) || {
        echo "  ⚠️  Timed out or errored after ${TIMEOUT}s"
        WARM_OUTPUT="{\"username\":\"$USERNAME\",\"success\":false,\"error\":\"timeout_${TIMEOUT}s\",\"captcha_hit\":false}"
    }

    echo "$WARM_OUTPUT" > "$ACCT_LOG"

    WAS_SUCCESS=$(echo "$WARM_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('success',False))" 2>/dev/null || echo "False")
    CAPTCHA=$(echo "$WARM_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('captcha_hit',False))" 2>/dev/null || echo "False")

    if [ "$WAS_SUCCESS" = "True" ]; then
        POSTS=$(echo "$WARM_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('posts_read',0))" 2>/dev/null || echo "0")
        UPVOTES=$(echo "$WARM_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('upvotes',0))" 2>/dev/null || echo "0")
        COMMENTS=$(echo "$WARM_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('comments_posted',[]).__len__())" 2>/dev/null || echo "0")
        BW_MB=$(echo "$WARM_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('bandwidth',{}).get('mb_total','?'))" 2>/dev/null || echo "?")
        ACTIVE_MIN=$(echo "$WARM_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('active_minutes',0))" 2>/dev/null || echo "0")
        echo "  ✅ Success — ${POSTS} posts, ${UPVOTES} upvotes, ${COMMENTS} comments, ${BW_MB} MB"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    else
        echo "  ❌ Failed"
        if [ "$CAPTCHA" = "True" ]; then
            echo "  🚫 CAPTCHA detected"
        fi
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi

    RESULTS+=("$WARM_OUTPUT")
    echo "$WARM_OUTPUT" >> "$RESULTS_FILE"

    # Close profile
    echo "  🔒 Closing profile..."
    curl -s "$ADS_API/browser/stop?user_id=$USER_ID" -H "Authorization: $ADS_AUTH" > /dev/null 2>&1 || true

    # Stagger between premium accounts (30-60s — longer gap than regular)
    if [ "${#ACCT_LIST[@]}" -gt 1 ]; then
        STAGGER=$((RANDOM % 31 + 30))
        echo "  ⏳ Waiting ${STAGGER}s before next account..."
        sleep "$STAGGER"
    fi
done

# Update state
echo ""
echo "📝 Updating premium-state.json..."
python3 -c "
import json, sys
from datetime import datetime

with open('$STATE_FILE') as f:
    state = json.load(f)

with open('$RESULTS_FILE') as f:
    results_raw = f.read()

for line in results_raw.strip().split('\n'):
    if not line.strip():
        continue
    try:
        r = json.loads(line)
        username = r.get('username', '')
        # Find account by reddit_username
        acct_name = None
        for name, acct in state.get('accounts', {}).items():
            if acct.get('reddit_username') == username:
                acct_name = name
                break
        if not acct_name:
            continue
        acct = state['accounts'][acct_name]

        session = {
            'date': r.get('timestamp', datetime.now().isoformat()),
            'phase': r.get('phase', acct.get('current_phase', 1)),
            'posts_read': r.get('posts_read', 0),
            'upvotes': r.get('upvotes', 0),
            'downvotes': r.get('downvotes', 0),
            'comments': len(r.get('comments_posted', [])),
            'saves': r.get('saves', 0),
            'success': r.get('success', False),
            'captcha_hit': r.get('captcha_hit', False),
        }

        acct.setdefault('sessions', []).append(session)

        if r.get('success'):
            acct['total_upvotes'] = acct.get('total_upvotes', 0) + r.get('upvotes', 0)
            acct['total_comments'] = acct.get('total_comments', 0) + len(r.get('comments_posted', []))
            acct['last_session'] = r.get('timestamp', '')

            # Phase advancement logic — requires BOTH session count AND elapsed time
            phase = acct.get('current_phase', 1)
            first_date = acct.get('first_session_date')
            days_elapsed = 0
            if first_date:
                try:
                    from datetime import date
                    d0 = date.fromisoformat(first_date[:10])
                    days_elapsed = (date.today() - d0).days
                except:
                    pass
            
            if phase == 1:
                acct['successful_browse_sessions'] = acct.get('successful_browse_sessions', 0) + 1
                # Need 2+ successful sessions AND at least 1 day elapsed
                if acct['successful_browse_sessions'] >= 2 and days_elapsed >= 1 and not r.get('captcha_hit'):
                    acct['current_phase'] = 2
                    print(f'  ⬆️  {acct_name} advanced to Phase 2 (Voice Reactivation) — day {days_elapsed}')
            elif phase == 2:
                if len(r.get('comments_posted', [])) > 0:
                    acct['successful_comment_sessions'] = acct.get('successful_comment_sessions', 0) + 1
                # Track removed comments from verification
                acct['removed_comments'] = acct.get('removed_comments', 0) + r.get('removed_comments', 0)
                # Need 3+ comment sessions AND at least 4 days elapsed AND zero removed comments
                if (acct.get('successful_comment_sessions', 0) >= 3 
                    and days_elapsed >= 4 
                    and acct.get('removed_comments', 0) == 0):
                    acct['current_phase'] = 3
                    print(f'  ⬆️  {acct_name} advanced to Phase 3 (Operational) — day {days_elapsed}')

        if r.get('captcha_hit'):
            acct['captcha_count'] = acct.get('captcha_count', 0) + 1

        # Set first session date
        if not acct.get('first_session_date') and r.get('success'):
            acct['first_session_date'] = r.get('timestamp', datetime.now().isoformat())[:10]

    except (json.JSONDecodeError, KeyError):
        continue

with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
print('Premium state updated.')
"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "📊 Premium Summary: $SUCCESS_COUNT success, $FAIL_COUNT failed"
echo "═══════════════════════════════════════════════════════════"
echo "📁 Session log: $SESSION_LOG"

# Cleanup temp file
rm -f "$RESULTS_FILE"
