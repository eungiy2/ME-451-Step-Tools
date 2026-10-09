# STUDENT PLAN — LLM Interaction with Graph Representations of Solid Models + PMI

Course: ME 497 / ME 451 mini-project, **Topic 3: Training a Manufacturing Software
Agent to Correlate Design Intent with Tolerances** (Fall 2026)

- **Team size:** four students (per course rules for 4-credit-hour enrollment).
- **Final deliverable:** an eight-page technical paper in NAMRC format
  (skeleton: `namrc54-abstract.tex` in repo root; template in `asmeconf/`).
- **Budget:** $100 for physical example parts used in classroom demonstrations.
- **Course policy on AI:** see the *AI Use Clause* section at the bottom of
  this document — read it before writing any part of the paper.

---

## Learning objectives

By the end of the project a student will be able to:

1. Read AP242 STEP files and explain how B-Rep topology and PMI (datums, DRFs,
   dimensions, geometric tolerances) are encoded in them.
2. Interpret GD&T callouts per ASME Y14.5 and connect them to part geometry.
3. Design a graph representation of a solid model that carries both geometric
   (topology, convexity/concavity) and semantic (PMI, features) information.
4. Design and execute controlled experiments testing whether LLM agents can
   parse, reason about, and act on that graph representation.
5. Build a gold-standard dataset pairing parts with feature/tolerance/
   manufacturing-operation descriptors, suitable for training a DL pipeline.

---

## Task 1 — Read the materials, use an LLM to learn the code and standards

**Goal:** Build enough understanding of the code, the standards, and the sample
files to modify the program confidently in Task 2 — *using an LLM agent as a
learning tool, and documenting what it does and does not help with.*

### Steps

1. **Environment setup.** Install Node.js; `npm install` inside
   `Project Materials/STEP Tools/`; run `npm run dev`; load sample files from
   `STEP samples with PMI/AP242/` and inspect faces, edges, datums, and FCFs
   in the viewer.
2. **Read, in this order:**
   - `Project Materials/STEP Tools/README.md` and `CLINE.md`
   - `Project Materials/STEP Tools/docs/PROJECT_ARCHITECTURE_AND_ROADMAP.md`
   - `docs/OCCT_NATIVE_TOPOLOGY_PLAN.md` and `docs/COMPACT_PMI_MODE_PLAN.md`
   - ASME Y14.5 (library copy) — focus on: datum features, datum reference
     frames, dimensional tolerances, and the 14 geometric characteristic
     symbols, especially position, profile, orientation, and form controls.
3. **Open one STEP file by hand** (e.g. `nist_ctc_01_asme1_ap242-e1.stp` in a
   text editor). Find: `ADVANCED_FACE` entities, `CYLINDRICAL_SURFACE`,
   dimensional tolerance entities, datum feature symbols, and geometric
   tolerance entities. Map at least three PMI callouts from raw STEP entities
   to what the viewer displays.
4. **LLM-assisted code comprehension.** Using opencode with GLM 5.3-flash
   (Lumen, see `opencode.json`; ask Prof. Correa about `LUMEN_API_KEY`):
   - Ask the agent to explain the data flow
     `stepParser.ts → pmiTopologyReferences.ts → stepOcctParser.ts → viewer`.
   - Ask it to trace how one specific tolerance (e.g. the position FCF in
     `nist_ctc_02`) reaches the screen.
   - Record every question you ask, the answer, and whether you verified it
     against the code. *Unverified LLM explanations do not count as
     understanding.*

### Deliverable 1 (internal checkpoint — feeds the course abstract, due 9/17)

- A 3–5 page report: architecture diagram of the program, a walkthrough of one
  PMI callout from STEP file to screen, a 1-page ASME Y14.5 summary, and an
  appendix of your LLM Q&A log with your verification notes.

---

## Task 2 — Encode STEP + PMI as a graph (the core design task)

**Goal:** Extend the program with an exporter that emits the loaded part as a
graph `G = (V, E)` in JSON, where **node and edge attribute design is the
deliverable** — treat it as a research design problem, not a dump of everything.

### Requirements

- **Minimum geometric information** (explicitly required):
  - Face-adjacency graph: node per face, edge per shared topological edge.
  - **Convexity/concavity** of each face-to-face adjacency (the dihedral sign
    at the shared edge), plus the dihedral angle.
  - Surface type per node (plane, cylinder, cone, sphere, torus, B-spline).
  - Edge type where relevant (line, circle, ellipse).
- **PMI information** (attach, don't merge):
  - Nodes for PMI records (datums, dimensions, geometric tolerances/FCFs)
    with typed attributes (tolerance value, zone shape, modifiers such as
    ⌀ / MMC / LMC, datum references).
  - Edges linking each PMI node to the exact faces/edges it applies to —
    reuse `pmiTopologyReferences.ts` resolution; do not invent a second
    mapping route.
  - Preserve unresolved/ambiguous associations as explicit attributes —
    never silently drop or guess them.
- **Serialization:** versioned JSON (e.g. `{ "graphVersion": 1, "source":
  {...}, "nodes": [...], "edges": [...] }`), one file per loaded part, plus a
  human-readable summary. Keep it deterministic: same STEP file in, byte-identical
  graph out (modulo a timestamp field).

### Design questions to answer in your report (and defend)

- Node-per-face vs. node-per-feature: which goes in the base graph and which
  is derived? (The codebase roadmap already plans a feature-recognition layer
  — Task 2 builds the substrate it would consume.)
- How do you represent tolerance *zones* vs. tolerance *values*?
- How do you represent a datum reference frame (ordered datum list) without
  turning the graph into a tree?
- What convexity/concavity computation do you use for cylindrical and
  partial-cylindrical faces (hint: the viewer code already fits cylinders)?
- What is the minimum graph that still lets an LLM answer manufacturing
  questions? Bigger is not better — every extra attribute is context-window
  cost in Task 3.

### Deliverable 2 (internal checkpoint — feeds the first paper draft, due 10/22)

- `exportGraph` capability in the app (or a script over the same modules) +
  graphs for all NIST AP242 fixtures, a graph **specification document**
  (node/edge schema with rationale and an example snippet per entity type),
  and lint/build passing. Include one AP203 file as a negative control
  (geometry only, no PMI).

---

## Task 3 — Can standard LLMs parse and reason over the graph?

**Goal:** Answer empirically whether off-the-shelf LLM agents — without
fine-tuning — can consume the Task 2 graph and perform manufacturing
reasoning. This produces the experimental section of the term paper.

### Test agents

1. **GLM 5.3-flash** (UIUC Lumen) via opencode — API integration already
   configured in `opencode.json`.
2. **GPT** ("Terra") — Prof. Correa will set up access.

### Capability ladder (run identical prompts against both agents)

| Level | Capability | Example probe |
|---|---|---|
| L0 | Parse | "List all faces, their surface types, and adjacency count." |
| L1 | Feature recognition | "Identify all holes, slots, pockets, counterbores. Give supporting face IDs." |
| L2 | Tolerance comprehension | "Explain each feature control frame and which faces it applies to. State the DRF." |
| L3 | Design commentary | "Comment on datum scheme choice, tolerance stack-up risks, and manufacturability concerns." |
| L4 | Manufacturing prediction | "Predict the manufacturing operations, sequence, and machine setup for this part." |
| L5 | Time & cost estimate | "Estimate machining time and cost; state your assumptions." |

### Experimental hygiene (this is the research contribution)

- **Ground truth:** NIST fixtures ship with known feature inventories; where
  the NIST documentation doesn't cover a quantity (e.g. cost), create it with
  a human expert (team + Prof. Correa) *before* running the LLM.
- **Scoring:** define metrics per level — e.g. feature precision/recall vs.
  ground truth, tolerance interpretation correctness (binary per FCF),
  operation-sequence similarity, cost % error.
- **Controls:** run the same probes on (a) raw STEP text, (b) graph JSON,
  (c) graph JSON + your spec document — to isolate whether the *graph
  representation* (not just the model) is what helps or hurts.
- **Ablations:** strip convexity attributes; strip PMI edges; re-run L1 and
  L2. Measure the drop.
- Log model, temperature, graph version, prompt, and raw output for every run.

### Deliverable 3 (internal checkpoint — feeds Results & Discussion, due in final paper 11/19)

- A results matrix (agents × levels × representations) with scores, a written
  analysis of failure modes (where does the LLM misread the graph? geometry?
  GD&T semantics? arithmetic?), and the full experiment log. This section
  drafts directly into the term paper's Results.

---

## Task 4 — Test/train dataset for a deep-learning pipeline

**Goal:** Produce a dataset pairing parts with structured descriptors
(features, tolerances, manufacturing operations) suitable for training a DL
model — the follow-on to the term paper ("Training a Manufacturing Software
Agent to Correlate Design Intent with Tolerances").

### Two dataset sources, kept separate and labeled

1. **LLM-generated** — use the Task 3 pipeline to produce descriptors for all
   graph-exported parts (the "previous version" approach). Mark provenance =
   `llm:<model>:<graphVersion>`.
2. **Human gold standard** — expert-verified descriptors for:
   - NIST test fixtures (`nist_ctc/ftc/stc` AP242 set),
   - the **Shenbio jig** part(s) (obtain from Prof. Correa),
   - **2–3 parts designed by the team**, deliberately covering feature types
     the NIST parts miss (slots, compound datums, profile tolerances, etc.).
   Mark provenance = `human:<annotator>`.

Each part record: `graph.json` (Task 2 format) + `descriptor.json`
(features with supporting face IDs, tolerances with associations, operation
sequence, material, time/cost where known) + a free-text manufacturing
rationale written by the annotator or front-line LLM.

### Validation

- Use the human gold set to score the LLM-generated descriptors (re-run Task 3
  metrics on the expanded corpus).
- Define a train/dev/test split rule now (suggest: dev/test must contain at
  least one human part and one feature type absent from training).
- Write the dataset card: counts, feature-type distribution, known gaps.

### Deliverable 4 (internal checkpoint — feeds Methodology/Results + Future Work, final paper due 11/19)

- Versioned dataset in the repo (or Box, if large) with dataset card; scoring
  report of LLM vs. human descriptors; a short section describing how this
  corpus would train the DL pipeline (input graph → predicted descriptor).

---

## Course timeline and grading (official)

Three graded deliverables, all sections of the eight-page NAMRC-format paper:

| Date | Course deliverable | Grade | What the team turns in |
|---|---|---|---|
| **Wed 9/17** | **Deliverable 1 — Final Paper Abstract** | 20% | ~1 page: purpose of the project, work performed, methods, principal findings and conclusions. At this date the abstract should present the plan plus any early Task 1/Task 2 results (e.g. the graph schema and a first exported graph). |
| **Wed 10/22** | **Deliverable 2 — Final Paper First Draft** | 20% | Full draft with Introduction, Literature Review, Methodology (graph design + experiment design), and preliminary Results from the Task 3 capability ladder. Figures and tables numbered and referenced. |
| **Wed 11/19** | **Deliverable 3 — Final Term Paper Report** | 60% | Complete 8-page NAMRC paper: Abstract, Introduction, Technical Sections (literature review, methodology, software implementation, results and discussion), Conclusions and Future Work, References per NAMRC guidelines. |

### Working schedule behind the graded deliverables

| Window | Work |
|---|---|
| by 9/4 | Team formation in the Project Team Formation Sheet (course deadline). |
| by 9/16 | Task 1: environment up, code + ASME Y14.5 reading, STEP dissection; Task 2 schema design underway. |
| **9/17** | **Course Deliverable 1: abstract due** (20%). |
| by 10/21 | Task 2 done (exporter + graphs for all fixtures + spec doc); Task 3 capability ladder run on both agents; literature review written. |
| **10/22** | **Course Deliverable 2: first draft due** (20%). |
| by 11/18 | Task 3 analysis complete (failure modes, ablations); Task 4 dataset built (LLM + human gold standard incl. Shenbio jig and team parts); all figures finalized; $100 demo parts produced. |
| **11/19** | **Course Deliverable 3: final paper due** (60%). |

Note: incremental results are explicitly valuable for this topic — partial
advancement is acceptable per the course topic description, but scope the
abstract to what you will actually deliver by 11/19.

## Paper structure (course requirement, maps to NAMRC sections)

1. **Abstract / Executive Summary** (~1 page): purpose, work performed, methods, principal findings and conclusions.
2. **Introduction:** background, motivation, objectives, scope — why linking tolerances to design intent and manufacturing matters.
3. **Technical Sections** (logical sequence, as applicable):
   - Literature review (PMI capture in CAD, graph-based B-rep representations, LLMs in engineering design/manufacturing)
   - Design requirements and constraints
   - Methodology (graph representation design — Task 2)
   - Software implementation (the STEP Tools extension — Task 2)
   - Experimental methods and results/discussion (capability ladder — Task 3; dataset — Task 4)
   - All figures/tables numbered, referenced in text, and interpreted — results are never presented without interpretation.
4. **Conclusions and Future Work:** findings vs. objectives, limitations, open challenges.
5. **References:** scholarly sources (Google Scholar, Engineering Village, publisher databases) formatted per NAMRC guidelines.

## Suggested role split (team of four)

- **A — Graph engineer:** owns Task 2 exporter, convexity/concavity math, determinism.
- **B — Experiment lead:** owns Task 3 prompts, logging, scoring, statistics.
- **C — Data curator:** owns Task 4 gold standards, dataset card, demo parts ($100 budget).
- **D — Paper lead:** owns the NAMRC document, figures/tables, references, and milestone assembly; cross-checks everyone's sections into the 8-page limit.

All roles share Task 1; everyone reads `PROJECT_ARCHITECTURE_AND_ROADMAP.md`
and follows the repo engineering rules. The paper is a team product — every
member writes at least one technical section.

## AI Use Clause (course policy — applies to the PAPER, read carefully)

Per course policy: *"The use of Large Language Model (LLM) artificial
intelligence systems for the creation, analysis, or synthesis of information
in this assignment is strictly prohibited. The only permitted use of AI tools
is for grammar and style corrections. Any suspicion of unauthorized AI use
will be referred to the corresponding ethics and academic integrity division
for investigation and possible disciplinary action."*

How this applies to **this topic** specifically — there is a critical
distinction:

- **Using LLMs as the experimental subject is the project itself** and is
  expected: feeding the graph to GLM 5.3-flash / GPT, collecting and analyzing
  their outputs, and reporting those results in the paper is the research
  method, not a policy violation. LLM-generated text belongs in the paper
  only as quoted experimental data/results, clearly labeled as such.
- **LLMs may not write, analyze, or synthesize the paper's own content** — no
  LLM-drafted introduction, literature review, discussion, or conclusions; no
  LLM-generated literature summaries or citations (also verify every citation
  manually: fabricated references are an integrity violation regardless of
  how they were produced).
- **Permitted:** grammar and style corrections only. If you use even that,
  you **must notify the instructor in writing as a separate section of your
  report** stating that grammar correction was the only AI use.
- The Task 1 "LLM-assisted code comprehension" Q&A log is a learning exercise
  and internal record — it informs your own understanding but its text must
  not be pasted into the paper as authored content.
