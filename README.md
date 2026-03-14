# ai-orchestrator-pitix

Isolated backend service for the PitiX AI sales assistant.

Phase 1 responsibilities:
- Accept audio or transcript input from `PitiXAiSales`.
- Run speech recognition through a provider abstraction.
- Parse retail sale intent into a reviewable draft.
- Match customers and products through a PitiX backend adapter.
- Create a sale only after explicit confirmation.

What stays out of this service:
- Cashflow invoice naming and share-link logic.
- Telegram flows from the existing orchestrator.
- Any direct mutation without explicit review/confirm intent.

See [docs/integration-contract.md](./docs/integration-contract.md) for the app/backend contract.

