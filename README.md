# Aldi AI-Ops mini projektek

| # | Projekt | Állapot |
|---|---------|---------|
| 1 | n8n AI agent workflow (support e-mail → LLM osztályozás → ticket) | ✅ kész |
| 2 | Langfuse-integráció (trace-ek, költség, latencia) | ⏳ |
| 3 | Hibaág és alerting (Slack/e-mail LLM-hiba vagy guardrail esetén) | ⏳ |
| 4 | Runbook: LLM provider 429 / timeout | ⏳ |
| 5 | Postmortem egy szimulált incidensről | ⏳ |

---

## 1. projekt – Support e-mail → LLM osztályozás → ticket

### Architektúra

```
Webhook (teszt)  ─┐
IMAP (éles, opc.) ┴─► Normalize email ─► LLM: classify ─► Parse & guardrails ─► Create ticket ─► Respond
                      (prompt + séma)    (HTTP, 3x retry,  (JSON-validálás,      (Postgres)
                                          30s timeout)      injection, safety)
```

**Miért így?**
- **OpenAI-kompatibilis HTTP hívás** (nem a beépített AI node): a base URL env változóból jön, így a 2. projektben
  egyetlen sorral átirányítható egy LiteLLM/Langfuse proxyra, a 4. projektben pedig a 429/timeout szimulálható.
- **Strict JSON schema** az LLM-től, de ezt **utólag is validáljuk**, mert nem minden provider tartja be.
- **Guardrailek kódban, nem csak promptban**: regex alapú prompt-injection szűrés, alacsony confidence küszöb (0.6),
  egészségügyi kulcsszavaknál kötelező P1 (biztonsági felülírás).
- Guardrail találat esetén a ticket **nem vész el**, hanem a `manual_triage` sorba kerül, és az ok a
  `guardrail_reasons` mezőbe íródik → erre épül a 3. projekt alertingje.
- **Idempotencia**: `message_id` UNIQUE, ugyanaz a levél kétszer nem hoz létre két ticketet.
- Minden tickethez mentjük: modell, latencia, prompt/completion tokenek → alap a 2. projekt költségméréséhez.

### Kategóriák → sorok

| Kategória | Sor (queue) |
|---|---|
| order_delivery | logistics |
| refund_return | customer_care |
| product_quality | quality_assurance |
| billing_payment | finance |
| account_app | digital |
| store_feedback | store_ops |
| other | customer_care |
| *(guardrail találat)* | manual_triage |

Prioritás: P1 biztonság/jogi · P2 pénzügyi kár, dühös ügyfél · P3 normál · P4 kérdés/dicséret.

### Futtatás

1. **Környezet**
   ```bash
   cp .env.example .env      # írd be az LLM_API_KEY-t
   docker compose up -d
   ```
   n8n: http://localhost:5678 (első indításkor owner fiók létrehozása).

2. **Postgres credential** az n8n-ben (Credentials → New → Postgres):
   Host `postgres`, Database `support`, User `n8n`, Password `n8n_pass`, Port `5432`. Név: `Support DB`.

3. **Workflow import**: Workflows → Import from File → `01-n8n-triage/workflow.json`.
   A *Create ticket (Postgres)* node-ban válaszd ki a `Support DB` credentialt. Mentés, majd **Active**.

4. **Teszt**
   ```bash
   ./01-n8n-triage/send_test.sh
   ```
   Teszt módban (az editorban az „Execute workflow” gomb után) `./send_test.sh test`. Ilyenkor egyszerre csak
   egy kérést fogad, ezért a fájlokat egyenként küldd.

5. **Eredmény**
   ```bash
   docker compose exec postgres psql -U n8n -d support \
     -c "select id, category, priority, queue, guardrail_reasons, summary from tickets order by id;"
   docker compose exec postgres psql -U n8n -d support -c "select * from ticket_stats;"
   ```

### Elvárt eredmények a teszt e-mailekre

| Fájl | Kategória | Prioritás | Sor |
|---|---|---|---|
| 01-keses | order_delivery | P3 | logistics |
| 02-allergia | product_quality | **P1** | quality_assurance |
| 03-dupla-terheles | billing_payment | P2 | finance |
| 04-app-login (német) | account_app | P3 | digital |
| 05-dicseret | store_feedback | P4 | store_ops |
| 06-injection | – | – | **manual_triage** (`regex_injection_pattern`, `llm_flagged_injection`) |

### Hibaelhárítás

- **`$env` access denied** → ellenőrizd, hogy `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` szerepel a compose fájlban.
- **Postgres paraméter hiba** (régebbi n8n verziók nem fogadnak tömböt a Query Parameters mezőben) → frissítsd az n8n-t,
  vagy írd át a lekérdezést `$1` helyett `'{{ JSON.stringify($json.ticket).replace(/'/g,"''") }}'::jsonb` formára.
- **`response_format` nem támogatott** (nem-OpenAI provider) → töröld a `response_format` blokkot a *Normalize email*
  node-ból; a *Parse & guardrails* továbbra is validál, és hibás JSON esetén a `manual_triage` sorba tesz.

### Fájlok

```
docker-compose.yml          n8n + Postgres
.env.example                LLM beállítások
db/init.sql                 support DB, tickets tábla, ticket_stats nézet
01-n8n-triage/
  workflow.json             importálható n8n workflow
  src/normalize.js          a "Normalize email" Code node forrása (prompt + JSON schema)
  src/validate.js           a "Parse & guardrails" Code node forrása
  test-emails/*.json        6 teszt e-mail (HU/DE, allergia, dupla terhelés, prompt injection)
  send_test.sh              teszt e-mailek elküldése a webhookra
```
