# 운영 실패 알림

`operational_alerts`는 다음 문제를 중복 없이 기록하는 server-only outbox입니다.

- co-running detection job이 5회 재시도 후 최종 실패
- detection job이 복구 시간보다 오래 잠김
- co-running, 요청 정리, 알림 수집 Cron 자체의 SQL 실행 실패

원본 GPS 좌표는 알림에 포함하지 않습니다. 요청 만료와 예약 제재 reconciliation은 `maintain-social-state-every-minute` Cron으로 실행됩니다.

## Webhook 연결

Slack 중계 서버, PagerDuty Events API 중계 서버 등 JSON POST를 받는 운영 endpoint를 Edge Function secret으로 설정합니다.

```powershell
npx.cmd supabase secrets set OPERATIONS_ALERT_WEBHOOK_URL=https://YOUR-ALERT-ENDPOINT
npx.cmd supabase functions deploy detect-co-running --no-verify-jwt
```

Webhook이 없거나 전송에 실패하면 alert는 `delivered_at is null` 상태로 남습니다. Dashboard SQL Editor에서 다음처럼 확인할 수 있습니다.

```sql
select id, category, severity, message, details, last_detected_at
  from public.operational_alerts
 where delivered_at is null and acknowledged_at is null
 order by last_detected_at desc;
```

DB/Edge Function 전체 장애는 내부 webhook도 보낼 수 없으므로 Supabase 외부의 uptime monitor로 Edge Function health 요청과 프로젝트 상태를 별도 감시해야 합니다.
