# XION — Personalized AI Memory Research Brief

> A self-hosted personal AI system exploring long-term memory and the role of local AI compute in persistent, everyday AI workloads.

## TL;DR

**XION** is the personal AI assistant I use, and **Galpi** is the self-hosted system behind it: server, persistent memory, retrieval, tools, storage, voice, tasks, and bounded automation.

The system already runs continuously on a Raspberry Pi and is accessed privately from my personal devices.

I am now designing and evaluating a new long-term memory architecture for XION. Alongside that work, I want to study a practical systems question:

> **Can small local models serve as an always-on processing layer for recurring memory workloads, with harder or higher-risk cases selectively escalated to cloud models?**

The goal is not to build a local chatbot benchmark. The goal is to evaluate local AI as a **continuous memory-compute layer** inside an AI system that is already used in daily life.

---

## 1. Current System

Galpi is a self-hosted personal AI system built around XION.

Currently implemented areas include:

- persistent conversation history
- long-term memory and bounded retrieval
- keyword- and embedding-based memory search
- automatic knowledge organization
- web-grounded answers
- academic paper discovery and selective full-text retrieval
- document and attachment search
- structured tasks and reminders
- Web Push notifications
- half-duplex voice conversation
- Raspberry Pi deployment and backup/recovery tooling
- Docker-based development and CI validation

Text and voice use the same memory and tool layer rather than operating as separate assistants.

The current main deployment runs continuously on a Raspberry Pi and is accessed privately through Tailscale.

Galpi is built as a system I actually use, not as a chatbot demo.

---

## 2. Long-Term Memory Research

The next major research track is a redesigned long-term memory architecture for XION.

The current design separates **source evidence** from **AI-derived memory state**, while preserving provenance and dependencies so that derived memories can be inspected, revised, or rebuilt without overwriting the original evidence.

Conceptually:

```text
Source Evidence
      ↓
Logical Evidence / Address Layer
      ↓
Derivation & Dependency Provenance
      ↓
Derived-State Transition
      ↓
Hypotheses / Derived Memory
      ↓
Context Assembly
      ↓
Reasoning / Action
```

The semantic and authority boundaries are designed first. Policies that cannot be determined from architecture alone are left open for empirical evaluation.

Examples include:

- which information should become derived long-term memory
- which memories should be retrieved for a given request
- how conflicting or ambiguous evidence should be handled
- when stable derived memory should be updated
- how consolidation should preserve exceptions and counter-evidence
- when uncertainty should remain unresolved instead of being forced into a single interpretation
- which memory operations require a stronger model

The experimental program uses shadow execution, replay, paired comparisons, and explicit measurement gates before changing production behavior.

---

## 3. Why Local AI?

A persistent personal AI has work to do even when the user is not explicitly asking for a chatbot response.

Examples include:

- memory routing
- structured information extraction
- conflict or ambiguity detection
- memory consolidation
- candidate memory promotion
- lightweight classification and policy decisions

Many of these operations may not require the strongest available model.

That creates a natural architecture:

```text
                 ┌───────────────────────┐
                 │      XION / Galpi     │
                 │ Persistent Personal AI│
                 └───────────┬───────────┘
                             │
                    Memory / Tool Work
                             │
                 ┌───────────▼───────────┐
                 │      Local Model      │
                 │ frequent / low-cost   │
                 │ memory processing     │
                 └───────────┬───────────┘
                             │
                   uncertain / complex
                             │
                 ┌───────────▼───────────┐
                 │      Cloud Model      │
                 │ stronger reasoning    │
                 │ selective escalation  │
                 └───────────────────────┘
```

The question is not whether a local model can answer general chat prompts.

The more useful question is:

> **Which persistent personal-AI tasks are reliable and economical enough to keep local, and which should be escalated?**

---

## 4. Planned Evaluation

The memory research itself has its own staged experimental queue.

In addition, the execution layer can be evaluated across configurations such as:

- **Local-first**
- **Local + Cloud hybrid**
- **Cloud-centered**

Depending on the task, useful measurements may include:

| Area | Example measurements |
|---|---|
| Quality | extraction accuracy, memory error, false update, missed update |
| Routing | escalation frequency, abstention rate, decision sensitivity |
| Performance | latency, throughput, background processing time |
| Cost | API usage, inference cost, local-vs-cloud workload share |
| Operations | RAM/VRAM use, CPU/GPU load, power use, thermals, stability |
| Long-term behavior | correction incidents, stale memory, consolidation errors |

The exact measurement set should depend on the workload and hardware rather than being fixed only for the sake of benchmarking.

---

## 5. Hardware Use

The current Raspberry Pi deployment is sufficient for the existing server and automation layer, but it is not intended to be the final compute environment for local LLM experimentation.

A dedicated machine capable of running **small local language models in the few-billion-parameter range** would allow the local inference layer to become part of the real XION system rather than a separate benchmark setup.

A supported device would be used for:

1. continuous XION/Galpi operation
2. local inference for memory-related workloads
3. local / hybrid / cloud execution comparisons
4. long-duration operational testing
5. development of the next memory architecture

High-end workstation performance is not required. The important properties are stable local inference, sustained operation, and suitability as an always-on personal AI compute node.

If a hardware partner has specific measurements, workloads, or product questions they would like evaluated, I am open to collecting additional data where it fits within the project and can be measured responsibly.

---

## 6. Project Status

- **Existing XION/Galpi system:** actively used and under continuous development
- **Current deployment:** Raspberry Pi + private Tailscale access
- **Existing memory/retrieval system:** implemented
- **Next-generation memory architecture:** design complete enough to begin staged empirical evaluation
- **Local AI execution layer:** planned research and implementation track
- **Target:** real-world personal-use workload, not a synthetic chatbot demo

---

## About

**Shin Chanyong / 신찬용**  
Korea University — Mechanical Engineering  
XION / Galpi Developer

Repository: <https://github.com/y0o0ng/galpi>

> XION/Galpi is an independent personal project and is not presented as an official Korea University research project.
