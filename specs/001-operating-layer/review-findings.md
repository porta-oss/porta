# Setup Phase Review Findings

## P2: Non-atomic snapshot replacement (pre-existing)
- File: apps/worker/src/repository.ts:172-198
- replaceSnapshot does DELETE+INSERT without transaction wrapper
- Fix: Wrap in BEGIN/COMMIT or use Drizzle .transaction()

## P2: SET TRANSACTION READ ONLY no-op (pre-existing)
- File: apps/worker/src/providers.ts:499
- Outside a transaction, this statement does nothing
- Fix: Use SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY

## P3: Telegram bot token + webhook secret stored plaintext
- Files: apps/api/src/db/schema/telegram-config.ts:26, webhook-config.ts:29
- Should encrypt like connector configs (AES-256-GCM)
- Fix: Use encryptConnectorConfig/decryptConnectorConfig pattern
