---
status: draft
depends_on: []
last_updated: 2026-08-13
---

# Runbooks Index

One file per failure class, comms templates included: nightly-batch failure, recon mismatch, MID freeze, Rise outage, Rithmic SFTP failure, restore-from-backup.

Placeholder created at skeleton stage (MERIT_BUILD_MASTER_PROMPT.md, section 0.5). Content is generated in Wave 4. Source spec: section 7.

## Carried forward from earlier waves (write these in Wave 4, do not lose them)

| Runbook | Why it exists | Ruled at |
|---|---|---|
| **Support: "the trader swears the account id is right"** | The API returns `404`, not `403`, when a trader addresses a resource they do not own, so existence is never confirmed to a stranger ([API_CONTRACT §1](../../architecture/API_CONTRACT.md#1-conventions)). Support therefore never resolves an account from a trader-supplied id. The procedure is: authenticate the trader, look the identity up in the admin console, and read the account list from there. The runbook must say this in the first line, because the natural support instinct is to paste the id and conclude the system is broken | Wave 2 gate, 2026-08-13 ([DECISIONS](../../DECISIONS.md#wave-2-gate-closure-2026-08-13)) |
