# Galpi

**Galpi** is a self-hosted personal AI system for persistent memory, tools, voice, tasks, documents, and bounded automation.

**Xion** is the assistant the user interacts with. **Galpi** is the system behind it: the server, storage, retrieval, tools, and deterministic workflows.

> Built as a personal system that I use, not as a chatbot demo.

## What Galpi does

### Memory & retrieval

Conversations and structured state live in SQLite. Knowledge worth keeping is accumulated in human-readable Markdown QA logs, while rebuildable keyword and embedding indexes retrieve a small, high-signal context instead of entire notes.

The current A2 path conservatively retrieves ready topic chunks within an 8,000-character request budget. Codex acts as a bounded librarian: it may organize designated metadata regions, but validation protects source Q&A and user-authored content.

### Tasks & reminders

Tasks, due dates, recurrence, reminders, and delivery state have their own SQLite model and deterministic scheduler. Natural-language requests produce a candidate first; application code validates and writes only the confirmed action. Reminders survive restarts and can be delivered through Web Push.

### Voice & files

The production voice path is half-duplex: browser voice activity detection → transcription → the normal GPT and tool path → text-to-speech. Text and voice share the same assistant runtime.

Markdown, TXT, and PDF attachments can be searched during a conversation. Files become durable library material only after explicit promotion; indexed document and paper chunks are read selectively.

### Tools & papers

The main assistant uses the OpenAI Responses API with bounded tools for web evidence, document and academic-paper retrieval, mail search, scheduling, and current system context. Saved papers can be indexed for section- or page-level retrieval. Optional mail and news observers surface selected items without granting the model unrestricted write authority.

## Current architecture

```text
Xion Web / PWA
       │
       ▼
Galpi Node.js / Express
       ├── SQLite: conversations, tasks, state, receipts
       ├── Markdown Vault: human-readable knowledge
       ├── Retrieval & rebuildable indexes
       ├── GPT Responses runtime & bounded tools
       └── Deterministic schedulers and workers
                    │
                    └── Codex librarian (validated edit boundary)
```

The main deployment runs natively on a Raspberry Pi and is accessed privately through Tailscale. Docker is used for development and CI reproducibility, not as the current Pi service manager.

## Long-term memory research

> **Research and design — not the current production memory implementation.**

XION long-term memory is a separate research track:

- R1 cross-disciplinary landscape research is complete.
- R2 semantic architecture synthesis is complete as a canonical design.
- R3 empirical feasibility and behavior validation is underway.
- Production implementation will be staged only after measurement establishes what is useful and supportable.

The R2 design separates the following layers:

```text
Owning Sources
      ↓
Logical Evidence Registry
      ↓
Provenance-aware Derived State
      ↓
Typed Projections
      ↓
Context Assembly
```

It also keeps a hard semantic boundary:

```text
Skill != Commitment != Governance != Current Capability
```

These layers are a planned architecture, not a claim about deployed Galpi. The current R3 feasibility and instrumentation status is recorded in [`docs/memory-r3-p0-a-receipt.md`](docs/memory-r3-p0-a-receipt.md).

## Design principles

- Preserve canonical source data; derived indexes must be rebuildable.
- Retrieve bounded, high-signal context instead of whole corpora.
- Keep source evidence distinct from derived interpretation.
- Do not let probabilistic reasoning silently acquire operational authority.
- Keep important state changes deterministic, validated, and recoverable.
- Treat accessibility, validity, retention, and erasure as different concerns.
- Measure behavior before increasing autonomy.

## Current status

**Current production:** persistent chat and bounded retrieval, Codex-assisted knowledge organization, tasks and reminders, half-duplex voice, attachments and library documents, paper retrieval, bounded tools, and a native Raspberry Pi deployment.

**Memory research:** R2 semantic design is complete, while R3 feasibility and instrumentation validation remains active. The later architecture is not yet claimed as implemented.

Galpi is under active development and is primarily built for personal use. Detailed state and next work live in [`docs/roadmap.md`](docs/roadmap.md).

## Trading research

The [`trading/`](trading/) directory is a separate experimental research track. It focuses on point-in-time backtesting and deterministic execution and risk boundaries around probabilistic analysis.

It is not a finished live trading system. The canonical design is [`Swing Trading Agent Design v2`](docs/trading/strategies/Swing%20Trading%20Agent%20Design%20v2%202.md), and experiment outputs are indexed in [`trading/runs/README.md`](trading/runs/README.md).

## Running locally

```bash
git clone https://github.com/y0o0ng/galpi.git
cd galpi

npm install
cp .env.example .env

npm start
```

Configure the required API keys and local paths in `.env` before starting. Raspberry Pi deployment and recovery procedures are in [`docs/RASPBERRY_PI_RUNBOOK.md`](docs/RASPBERRY_PI_RUNBOOK.md).

## Tests

```bash
npm test
```

The repository also includes focused evaluation, audit, repair, and maintenance commands for individual subsystems.

## Roadmap

Galpi is developed incrementally; the detailed implementation history and next work live in [`docs/roadmap.md`](docs/roadmap.md).

The memory direction is deliberately staged:

```text
current bounded retrieval
        ↓
empirical memory validation
        ↓
staged canonical-architecture implementation
```

## Why I built this

I wanted a personal AI whose memory, tools, and data survive individual chats and remain under my control.

Galpi is also an ongoing experiment in keeping an explicit boundary between AI reasoning and deterministic software: models can interpret and propose, while validated application code owns important state and authority.

---

**Galpi** — the system.  
**Xion** — the assistant.
