#!/usr/bin/env bash
set -euo pipefail

cd "$HOME/.openclaw/workspace"
API="http://127.0.0.1:50325/api/v1"
AUTH="Authorization: Bearer 0d599e9255deef1bcc503d735da537160085c443c76f1c30"
STATE_FILE="BRAIN/warming/state.json"
WARM_SCRIPT="skills/account-warming/warm.py"
LOG_DIR="BRAIN/warming/logs"
TODAY=$(date +%Y-%m-%d)

ACCOUNTS=("k1bc5662|lhdqpdftdt" "k1bc56o0|vglmtlyrdm" "k1bc56pk|cuvuvcljco")

for ACCT in "${ACCOUNTS[@]}"; do
  IFS='|' read -r ADSPWR_ID UNAME <<< "$ACCT"
  echo ""
  echo "───── $UNAME (Day 4, Phase 2) ─────"
  
  RESP=$(curl -s "$API/browser/start?user_id=$ADSPWR_ID" -H "$AUTH")
  CDP=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('ws',{}).get('puppeteer',''))" 2>/dev/null || echo "")
  
  if [ -z "$CDP" ]; then
    echo "FAIL: Could not open browser: $RESP"
    continue
  fi
  
  sleep 5
  LOG_FILE="$LOG_DIR/${UNAME}_${TODAY}_retry.json"
  echo "Running warm.py..."
  
  SUBS=$(python3 -c "
import json
with open('$STATE_FILE') as f:
    s = json.load(f)
print(','.join(s['accounts']['$UNAME'].get('subreddits',[])))
")
  
  if [ -n "$SUBS" ]; then
    timeout 300 python3 "$WARM_SCRIPT" "$CDP" "$UNAME" 2 --subreddits "$SUBS" > "$LOG_FILE" 2>&1 || true
  else
    timeout 300 python3 "$WARM_SCRIPT" "$CDP" "$UNAME" 2 > "$LOG_FILE" 2>&1 || true
  fi
  
  if python3 -c "import json; json.load(open('$LOG_FILE'))" 2>/dev/null; then
    python3 -c "
import json
with open('$LOG_FILE') as f:
    r = json.load(f)
print(f\"OK posts={r.get('posts_read',0)} up={r.get('upvotes',0)} comments={len(r.get('comments_posted',[]))} saves={r.get('saves',0)} success={r.get('success',False)}\")
"
    python3 -c "
import json
from datetime import datetime
with open('BRAIN/warming/state.json') as f:
    state = json.load(f)
with open('$LOG_FILE') as f:
    result = json.load(f)
acct = state['accounts']['$UNAME']
acct['current_phase'] = 2
acct['last_session'] = datetime.now().isoformat()
acct['total_upvotes'] = acct.get('total_upvotes', 0) + result.get('upvotes', 0)
acct['total_comments'] = acct.get('total_comments', 0) + len(result.get('comments_posted', []))
acct.setdefault('sessions', []).append({
    'date': datetime.now().isoformat(),
    'phase': 2, 'day': 4,
    'posts_read': result.get('posts_read', 0),
    'upvotes': result.get('upvotes', 0),
    'comments': len(result.get('comments_posted', [])),
    'saves': result.get('saves', 0),
    'success': result.get('success', False),
})
with open('BRAIN/warming/state.json', 'w') as f:
    json.dump(state, f, indent=2)
"
  else
    echo "FAILED - log contents:"
    tail -10 "$LOG_FILE" 2>/dev/null || echo "(no log)"
  fi
  
  curl -s "$API/browser/stop?user_id=$ADSPWR_ID" -H "$AUTH" > /dev/null 2>&1
  sleep 25
done

echo ""
echo "=== All remaining accounts processed ==="
