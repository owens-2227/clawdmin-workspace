#!/usr/bin/env bash
# Account Warming Orchestrator
# Opens AdsPower profiles, runs warm.py per account, closes profiles.
# Reads state from BRAIN/warming/state.json, updates after each session.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$HOME/.openclaw/workspace"
STATE_FILE="$WORKSPACE/BRAIN/warming/state.json"
WARM_SCRIPT="$SCRIPT_DIR/warm.py"
LOG_DIR="$WORKSPACE/BRAIN/warming/logs"
API="http://127.0.0.1:50325/api/v1"
AUTH="Authorization: Bearer 0d599e9255deef1bcc503d735da537160085c443c76f1c30"

mkdir -p "$LOG_DIR"

# ─── Load state ──────────────────────────────────────────────────────────────

if [ ! -f "$STATE_FILE" ]; then
    echo "ERROR: State file not found at $STATE_FILE"
    echo "Initialize it first via the skill setup."
    exit 1
fi

TODAY=$(date +%Y-%m-%d)
NOW=$(date +%H:%M)

echo "═══════════════════════════════════════════════════════"
echo "🔥 Account Warming Run — $TODAY $NOW"
echo "═══════════════════════════════════════════════════════"

# ─── Process each account ────────────────────────────────────────────────────

ACCOUNTS=$(python3 -c "
import json, sys
from datetime import datetime, timedelta

with open('$STATE_FILE') as f:
    state = json.load(f)

today = datetime.strptime('$TODAY', '%Y-%m-%d')

for uname, acct in state.get('accounts', {}).items():
    if acct.get('status') != 'warming':
        continue
    
    start = datetime.strptime(acct['start_date'], '%Y-%m-%d')
    day_num = (today - start).days + 1
    
    # Determine phase
    if day_num <= 3:
        phase = 1
    elif day_num <= 7:
        phase = 2
    elif day_num <= 11:
        phase = 3
    elif day_num <= 14:
        phase = 4
    else:
        # Account is ready
        phase = 0
    
    # Check if already ran today
    last = acct.get('last_session', '')
    if last and last.startswith('$TODAY'):
        sessions_today = sum(1 for s in acct.get('sessions', []) if s.get('date', '').startswith('$TODAY'))
        if sessions_today >= 2:
            continue  # Already did 2 sessions today
    
    subs = ','.join(acct.get('subreddits', []))
    print(f\"{acct['user_id']}|{uname}|{phase}|{day_num}|{subs}\")
")

if [ -z "$ACCOUNTS" ]; then
    echo "No accounts need warming today."
    exit 0
fi

RESULT_SUMMARY=""

while IFS='|' read -r USER_ID USERNAME PHASE DAY_NUM SUBS; do
    if [ "$PHASE" = "0" ]; then
        echo "✅ $USERNAME (day $DAY_NUM): Warming complete! Ready for deployment."
        # Update status
        python3 -c "
import json
with open('$STATE_FILE') as f:
    state = json.load(f)
state['accounts']['$USERNAME']['status'] = 'ready'
state['accounts']['$USERNAME']['current_phase'] = 5
with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
"
        RESULT_SUMMARY="${RESULT_SUMMARY}\n✅ $USERNAME: READY (day $DAY_NUM)"
        continue
    fi
    
    echo ""
    echo "───────────────────────────────────────────────────"
    echo "🔥 $USERNAME — Day $DAY_NUM, Phase $PHASE"
    echo "───────────────────────────────────────────────────"
    
    # Open AdsPower profile
    echo "  Opening browser profile ($USER_ID)..."
    OPEN_RESP=$(curl -s "$API/browser/start?user_id=$USER_ID" -H "$AUTH")
    CDP_URL=$(echo "$OPEN_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('ws',{}).get('puppeteer',''))" 2>/dev/null || echo "")
    
    if [ -z "$CDP_URL" ]; then
        echo "  ❌ Failed to open profile. Response: $OPEN_RESP"
        RESULT_SUMMARY="${RESULT_SUMMARY}\n❌ $USERNAME: Failed to open browser"
        continue
    fi
    
    echo "  CDP: $CDP_URL"
    
    # Wait for browser to fully load
    sleep 5
    
    # Run warming script
    LOG_FILE="$LOG_DIR/${USERNAME}_${TODAY}_$(date +%H%M).json"
    echo "  Running warm.py (phase $PHASE)..."
    
    if [ -n "$SUBS" ]; then
        python3 "$WARM_SCRIPT" "$CDP_URL" "$USERNAME" "$PHASE" --subreddits "$SUBS" > "$LOG_FILE" 2>&1
    else
        python3 "$WARM_SCRIPT" "$CDP_URL" "$USERNAME" "$PHASE" > "$LOG_FILE" 2>&1
    fi
    
    EXIT_CODE=$?
    
    # Parse results
    if [ $EXIT_CODE -eq 0 ] && python3 -c "import json; json.load(open('$LOG_FILE'))" 2>/dev/null; then
        RESULT=$(python3 -c "
import json
with open('$LOG_FILE') as f:
    r = json.load(f)
print(f\"posts={r.get('posts_read',0)} up={r.get('upvotes',0)} down={r.get('downvotes',0)} comments={len(r.get('comments_posted',[]))} saves={r.get('saves',0)} ok={r.get('success',False)}\")
")
        echo "  ✅ Done: $RESULT"
        
        # Update state
        python3 -c "
import json
from datetime import datetime

with open('$STATE_FILE') as f:
    state = json.load(f)

with open('$LOG_FILE') as f:
    result = json.load(f)

acct = state['accounts']['$USERNAME']
acct['current_phase'] = $PHASE
acct['last_session'] = datetime.now().isoformat()
acct['total_upvotes'] = acct.get('total_upvotes', 0) + result.get('upvotes', 0)
acct['total_comments'] = acct.get('total_comments', 0) + len(result.get('comments_posted', []))

# Append session summary
acct.setdefault('sessions', []).append({
    'date': datetime.now().isoformat(),
    'phase': $PHASE,
    'day': $DAY_NUM,
    'posts_read': result.get('posts_read', 0),
    'upvotes': result.get('upvotes', 0),
    'downvotes': result.get('downvotes', 0),
    'comments': len(result.get('comments_posted', [])),
    'saves': result.get('saves', 0),
    'success': result.get('success', False),
})

with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
"
        RESULT_SUMMARY="${RESULT_SUMMARY}\n✅ $USERNAME (P$PHASE D$DAY_NUM): $RESULT"
    else
        echo "  ❌ Script failed (exit $EXIT_CODE)"
        cat "$LOG_FILE" 2>/dev/null | tail -5
        RESULT_SUMMARY="${RESULT_SUMMARY}\n❌ $USERNAME: Script failed"
    fi
    
    # Close browser profile
    echo "  Closing browser..."
    curl -s "$API/browser/stop?user_id=$USER_ID" -H "$AUTH" > /dev/null 2>&1
    sleep 2
    
    # Stagger between accounts (20-30 seconds in automated mode)
    STAGGER=$((20 + RANDOM % 11))
    echo "  Waiting ${STAGGER}s before next account..."
    sleep "$STAGGER"
    
done <<< "$ACCOUNTS"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "🏁 Warming Run Complete"
echo -e "$RESULT_SUMMARY"
echo "═══════════════════════════════════════════════════════"
