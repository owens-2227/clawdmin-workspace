#!/bin/bash
# Account Warming Runner v2 — Rebuilt 2026-04-13
# Opens AdsPower profiles, runs warm.py per account, closes profiles.
# Designed to be called by the OpenClaw cron agent.
#
# Usage: ./run-warming.sh [--timeout 300]
#
# Reads accounts from state.json. Only warms accounts with status="warming".
# Per-account timeout prevents infinite hangs (default: 300s = 5min).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="$HOME/.openclaw/workspace/BRAIN/warming/state.json"
LOG_DIR="$HOME/.openclaw/workspace/BRAIN/warming/logs"
WARM_PY="$SCRIPT_DIR/warm.py"
CHECK_SHADOWBAN_PY="$HOME/.openclaw/workspace/BRAIN/warming/check-shadowbans.py"

ADS_API="http://127.0.0.1:50325/api/v1"
ADS_AUTH="Bearer 0d599e9255deef1bcc503d735da537160085c443c76f1c30"

# Use Jess's profile as the shadowban checker (different IP from warming accounts)
CHECKER_PROFILE_ID="k1abonj2"

TIMEOUT=300  # 5 minutes per account max

# Parse args
while [[ $# -gt 0 ]]; do
    case $1 in
        --timeout) TIMEOUT="$2"; shift 2 ;;
        *) shift ;;
    esac
done

mkdir -p "$LOG_DIR"

DATE=$(date +%Y-%m-%d)
TIME=$(date +%H%M)
SESSION_LOG="$LOG_DIR/warming-${DATE}-${TIME}.json"

echo "═══════════════════════════════════════════════════════════"
echo "🔥 Account Warming v2 — $(date '+%Y-%m-%d %H:%M %Z')"
echo "═══════════════════════════════════════════════════════════"

# ── Step 1: Read state, filter active accounts ──────────────────────────────

if [ ! -f "$STATE_FILE" ]; then
    echo "❌ No state.json found at $STATE_FILE"
    exit 1
fi

# Get active accounts (status=warming, not shadowbanned/suspended)
ACCOUNTS=$(python3 -c "
import json, sys
with open('$STATE_FILE') as f:
    state = json.load(f)
active = []
for name, acct in state.get('accounts', {}).items():
    if acct.get('status') == 'warming':
        active.append(json.dumps({
            'username': name,
            'user_id': acct['user_id'],
            'phase': acct['current_phase'],
            'subreddits': ','.join(acct.get('subreddits', [])),
        }))
print('|||'.join(active))
")

if [ -z "$ACCOUNTS" ]; then
    echo "⚠️  No active warming accounts found"
    echo '{"timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","accounts_run":0,"results":[]}' > "$SESSION_LOG"
    exit 0
fi

IFS='|||' read -ra ACCT_LIST <<< "$ACCOUNTS"
echo "📋 Found ${#ACCT_LIST[@]} active accounts"

# ── Step 2: Run shadowban check first (via checker profile) ─────────────────

echo ""
echo "🔍 Running shadowban check via checker profile..."
python3 "$CHECK_SHADOWBAN_PY" 2>&1 || echo "⚠️  Shadowban check failed — proceeding with caution"
echo ""

# ── Step 3: Warm each account ───────────────────────────────────────────────

RESULTS=()
SUCCESS_COUNT=0
FAIL_COUNT=0

for acct_json in "${ACCT_LIST[@]}"; do
    USERNAME=$(echo "$acct_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['username'])")
    USER_ID=$(echo "$acct_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['user_id'])")
    PHASE=$(echo "$acct_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['phase'])")
    SUBS=$(echo "$acct_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['subreddits'])")
    
    echo "────────────────────────────────────────"
    echo "👤 $USERNAME (phase $PHASE, profile $USER_ID)"
    
    # Check if account was flagged in shadowban check
    # (state.json updated by check-shadowbans.py)
    CURRENT_STATUS=$(python3 -c "
import json
with open('$STATE_FILE') as f:
    state = json.load(f)
print(state.get('accounts',{}).get('$USERNAME',{}).get('status','unknown'))
")
    
    if [ "$CURRENT_STATUS" != "warming" ]; then
        echo "  ⏭️  Skipping — status is '$CURRENT_STATUS'"
        continue
    fi
    
    # Open AdsPower profile
    echo "  🌐 Opening AdsPower profile..."
    ADS_RESP=$(curl -s "$ADS_API/browser/start?user_id=$USER_ID" -H "Authorization: $ADS_AUTH" 2>/dev/null || echo '{"code":-1}')
    CDP_URL=$(echo "$ADS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('ws',{}).get('puppeteer',''))" 2>/dev/null || echo "")
    
    if [ -z "$CDP_URL" ]; then
        echo "  ❌ Failed to get CDP URL"
        FAIL_COUNT=$((FAIL_COUNT + 1))
        RESULTS+=("{\"username\":\"$USERNAME\",\"success\":false,\"error\":\"no_cdp_url\"}")
        continue
    fi
    
    echo "  🔗 CDP: ${CDP_URL:0:50}..."
    sleep 3  # Let browser fully initialize
    
    # Run warm.py with timeout
    echo "  🏃 Running warm.py (phase $PHASE, timeout ${TIMEOUT}s)..."
    ACCT_LOG="$LOG_DIR/${USERNAME}-${DATE}-${TIME}.json"
    
    # macOS-compatible timeout using perl
    WARM_OUTPUT=$(perl -e "alarm $TIMEOUT; exec @ARGV" python3 "$WARM_PY" "$CDP_URL" "$USERNAME" "$PHASE" --subreddits "$SUBS" 2>&1) || {
        echo "  ⚠️  Timed out or errored after ${TIMEOUT}s"
        WARM_OUTPUT="{\"username\":\"$USERNAME\",\"success\":false,\"error\":\"timeout_${TIMEOUT}s\",\"captcha_hit\":false}"
    }
    
    # Save individual log
    echo "$WARM_OUTPUT" > "$ACCT_LOG"
    
    # Parse result
    WAS_SUCCESS=$(echo "$WARM_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('success',False))" 2>/dev/null || echo "False")
    CAPTCHA=$(echo "$WARM_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('captcha_hit',False))" 2>/dev/null || echo "False")
    
    if [ "$WAS_SUCCESS" = "True" ]; then
        POSTS=$(echo "$WARM_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('posts_read',0))" 2>/dev/null || echo "0")
        UPVOTES=$(echo "$WARM_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('upvotes',0))" 2>/dev/null || echo "0")
        COMMENTS=$(echo "$WARM_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('comments_posted',[]).__len__())" 2>/dev/null || echo "0")
        echo "  ✅ Success — ${POSTS} posts, ${UPVOTES} upvotes, ${COMMENTS} comments"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    else
        echo "  ❌ Failed"
        if [ "$CAPTCHA" = "True" ]; then
            echo "  🚫 CAPTCHA detected — this profile may need IP rotation"
        fi
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
    
    RESULTS+=("$WARM_OUTPUT")
    
    # Close AdsPower profile
    echo "  🔒 Closing profile..."
    curl -s "$ADS_API/browser/stop?user_id=$USER_ID" -H "Authorization: $ADS_AUTH" > /dev/null 2>&1 || true
    
    # Stagger between accounts (20-40s)
    if [ "${#ACCT_LIST[@]}" -gt 1 ]; then
        STAGGER=$((RANDOM % 21 + 20))
        echo "  ⏳ Waiting ${STAGGER}s before next account..."
        sleep "$STAGGER"
    fi
done

# ── Step 4: Update state.json ───────────────────────────────────────────────

echo ""
echo "📝 Updating state.json..."
python3 -c "
import json, sys
from datetime import datetime

with open('$STATE_FILE') as f:
    state = json.load(f)

results_raw = '''$(printf '%s\n' "${RESULTS[@]}")'''

for line in results_raw.strip().split('\n'):
    if not line.strip():
        continue
    try:
        r = json.loads(line)
        username = r.get('username', '')
        if username not in state.get('accounts', {}):
            continue
        acct = state['accounts'][username]
        
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
        
        if 'sessions' not in acct:
            acct['sessions'] = []
        acct['sessions'].append(session)
        
        if r.get('success'):
            acct['total_upvotes'] = acct.get('total_upvotes', 0) + r.get('upvotes', 0)
            acct['total_comments'] = acct.get('total_comments', 0) + len(r.get('comments_posted', []))
            acct['last_session'] = r.get('timestamp', '')
        
        # Auto-detect issues
        errors = r.get('errors', [])
        for err in errors:
            if 'shadowbanned' in err.lower() or 'suspended' in err.lower():
                acct['status'] = 'shadowbanned'
        
        if r.get('captcha_hit'):
            acct['captcha_count'] = acct.get('captcha_count', 0) + 1
            # 3 consecutive CAPTCHAs = flag for IP rotation
            if acct['captcha_count'] >= 3:
                acct['needs_ip_rotation'] = True
    except (json.JSONDecodeError, KeyError):
        continue

with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
print('State updated.')
"

# ── Step 5: Summary ─────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "📊 Summary: $SUCCESS_COUNT success, $FAIL_COUNT failed out of ${#ACCT_LIST[@]} accounts"
echo "═══════════════════════════════════════════════════════════"

# Save session log
python3 -c "
import json
results = []
raw = '''$(printf '%s\n' "${RESULTS[@]}")'''
for line in raw.strip().split('\n'):
    try:
        results.append(json.loads(line))
    except:
        pass
log = {
    'timestamp': '$(date -u +%Y-%m-%dT%H:%M:%SZ)',
    'accounts_run': ${#ACCT_LIST[@]},
    'success': $SUCCESS_COUNT,
    'failed': $FAIL_COUNT,
    'results': results
}
with open('$SESSION_LOG', 'w') as f:
    json.dump(log, f, indent=2)
"

echo "📁 Session log: $SESSION_LOG"
