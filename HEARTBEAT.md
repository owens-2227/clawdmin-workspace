# HEARTBEAT.md

Every heartbeat cycle, check:

1. **Stuck subagents** — If any subagent has been running > 30 minutes, kill it and alert Paul via Slack
2. **Failed cron jobs** — If any scheduled engagement job failed in the last cycle, alert Paul
3. **AdsPower reachable** — `curl -s http://local.adspower.net:50325/api/v1/status` — if unreachable, alert Paul
4. **BRAIN integrity** — Verify BRAIN directories exist and are writable

If nothing needs attention → reply HEARTBEAT_OK

If issues found, send Slack alert with: component, error/symptom, suggested fix.
