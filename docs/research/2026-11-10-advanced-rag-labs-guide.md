# Advanced RAG labs: a guide to the nine projects in `Advance rag/`

> The `Advance rag/` folder was third-party course code, read on the owner's machine and deleted after this guide was written. It was never part of this repository (the path stays gitignored), so the file paths below no longer resolve. No code from it was copied.

This guide explains what each project in `Advance rag/` does, and how together they build an advanced RAG (retrieval-augmented generation) application. I read every project's README and demo runbook, and the source code each lab adds.

## The big picture first

These nine folders are not nine separate apps. They are **one application, saved at the end of each lab of a course** (an "Advanced RAG Engineering" course). Each lab copies the previous one and adds a layer. So Lab 9 contains everything from Labs 1 to 8, plus its own work.

| Folder                        | Lab   | What it adds                                                                                       | Size (Python)            |
| ----------------------------- | ----- | -------------------------------------------------------------------------------------------------- | ------------------------ |
| `baseline_RAG_ application`   | 1     | A minimal RAG app that works, plus a benchmark showing where it fails                              | 30 files, ~1,200 lines   |
| `baseline_RAG_ application 2` | 2 + 3 | Enterprise ingestion (many file types, versions, smart chunking), then hybrid search and reranking | 82 files, ~6,000 lines   |
| `baseline_RAG_ application 3` | —     | **Empty.** Only empty folders and a Python virtualenv; no source code                              | 0                        |
| `lab04_…`                     | 4     | Query intelligence: classify, rewrite, expand, HyDE, route                                         | 111 files, ~8,800 lines  |
| `lab05_…`                     | 5     | Self-correcting RAG: grade the context, correct, verify the answer, abstain (LangGraph)            | 137 files, ~11,600 lines |
| `lab06_…`                     | 6     | GraphRAG: a knowledge graph with provenance, multi-hop traversal                                   | 163 files, ~14,300 lines |
| `lab07_…`                     | 7     | Multimodal: PDF pages, OCR, tables, figures, highlighted page citations                            | 199 files, ~17,100 lines |
| `lab08_…`                     | 8     | An evaluation harness: retrieval and answer metrics, regression tests                              | 229 files, ~19,900 lines |
| `lab09_…`                     | 9     | Observability and optimization: OpenTelemetry traces, caching, adaptive Top-K, cost                | 263 files, ~23,400 lines |

To see the finished system, read **Lab 9**. To understand _why_ each piece exists, read the labs in order, which is what this guide does.

### The stack (the same in every lab)

- **Python 3.11.** **FastAPI** (`api.py`) serves a `POST /query` API, and **Streamlit** (`app.py`) is a demo UI with one tab per lab.
- **Qdrant in "local mode"** (in-process, no server) is the vector index. **SQLite FTS5** is the keyword (BM25) index.
- **sentence-transformers** run on CPU: `all-MiniLM-L6-v2` for embeddings, and `cross-encoder/ms-marco-MiniLM-L6-v2` for reranking.
- **Ollama** (`llama3.2:3b`) is the optional local LLM.
- **Pydantic** for every data shape, and **pytest** for tests (89 test files by Lab 9).
- Later labs add **LangGraph** (5), **NetworkX** and **RapidFuzz** (6), **PyMuPDF**, **pdfplumber** and **Tesseract** (2 and 7), **Jinja2** (8), and **OpenTelemetry** with **Jaeger** (9).

Everything runs on a laptop CPU. No GPU, no cloud API.

### Two ideas that run through the whole course

These explain a lot of the code that looks odd at first.

1. **Every LLM step has a deterministic twin.** There is a "fixture" generator, deterministic graders and classifiers, and "hash" embeddings. The demos and tests are therefore reproducible: the same input always gives the same output, so a benchmark can be an _acceptance gate_. A live Ollama run is treated as a separate, second opinion, and its results are written to a different folder (`artifacts/ollama/` vs `artifacts/deterministic/`).
2. **The model is never trusted to make the important decisions.** The model can _suggest_ a rewrite, a grade or a graph fact. Plain Python code validates the suggestion, enforces budgets and decides what happens next. If the model's output is invalid, the code falls back to the deterministic answer and records a "fallback event". This is the most "production" idea in the course.

---

## Lab 1 — A baseline RAG app, measured honestly

**Goal:** build the simplest RAG that works, then _prove where it fails_, so every later lab has a measurable reason to exist.

### How it works

The pipeline is ingestion → chunking → embedding → vector search → prompt → generation.

1. **Loading** ([`baseline_loader.py`](<../../Advance rag/baseline_RAG_ application/src/ingestion/baseline_loader.py>)) reads `.txt`, `.md` and `.pdf`; PDFs are read page by page with `pypdf`, so each chunk keeps its page number.
2. **Chunking** ([`fixed_chunker.py`](<../../Advance rag/baseline_RAG_ application/src/chunking/fixed_chunker.py>)) collapses whitespace, then cuts fixed 500-character windows with an 80-character overlap. Chunk IDs look like `<doc>-<page>-<index>`.
3. **Embedding** has two backends:
   - `HashEmbeddingProvider` hashes each word into one of 384 buckets and normalizes the counts. It is deterministic and needs no model download, but it only matches _the same words_. That makes it a perfect way to _reproduce_ the classic vocabulary-mismatch failure.
   - `SentenceTransformerEmbeddingProvider` uses the real MiniLM model.
4. **Vector store:** Qdrant in memory, cosine distance. The whole chunk is stored as the payload.
5. **Prompt** ([`rag_pipeline.py`](<../../Advance rag/baseline_RAG_ application/src/generation/rag_pipeline.py>)) lists each chunk as `SOURCE / CHUNK_ID / CONTENT`, followed by an "output contract":
   - answer in one or two sentences;
   - cite source filenames in square brackets;
   - if the evidence is insufficient, output **exactly** the sentence "I could not find this information in the provided documents.";
   - never mix that sentence with an answer.
6. **Citations** are computed afterwards: a source counts as cited if its filename appears in the answer text.
7. **Latency** is measured per stage (embedding, retrieval, prompt, generation, total) and returned with every answer.

### The benchmark (the most important part of Lab 1)

`run_benchmark.py` runs five fixed questions, each chosen to expose one known weakness of naive RAG:

- **Vocabulary mismatch:** the question uses different words than the document.
- **Exact identifier:** a code like `INC-2025-00417`, which embeddings handle badly.
- **Multi-hop:** "who leads the division responsible for Project Atlas?" needs two documents.
- **Unsupported:** the answer is not in the corpus, so the right output is to abstain.
- **A plain fact**, as a control.

Each case checks four things: was the expected source retrieved, does the answer contain the expected fact, is the right source cited, and did it abstain exactly when it should. The results are exported as JSON, CSV, a `failure_analysis.md` and `run_metadata.json` (model, chunk settings, Top-K, corpus size). Each failure in the analysis file names its likely cause and the fix a later lab will bring: query expansion, hybrid search, reranking, filters or multi-step retrieval.

**Key lesson:** you can't improve RAG without a benchmark that names the failure types. Lab 1 builds that benchmark before building anything clever.

---

## Lab 2 — Enterprise ingestion (in `baseline_RAG_ application 2`)

**Goal:** real company documents are messy (PDF, Word, Excel, HTML, scanned images) and they change over time. Lab 2 makes ingestion handle that properly.

### 1. Many formats, one normalized shape

A **loader registry** ([`loaders/registry.py`](<../../Advance rag/baseline_RAG_ application 2/src/ingestion/loaders/registry.py>)) picks a loader by file type. Every loader outputs the same `NormalizedDocument`, a list of typed **blocks** (`title`, `heading`, `paragraph`, `list_item`, `table_row`, `ocr_text`), each with metadata:

| Loader | Library            | What it keeps                                                  |
| ------ | ------------------ | -------------------------------------------------------------- |
| PDF    | PyMuPDF (`fitz`)   | text blocks in reading order, page number, **bounding box**    |
| HTML   | BeautifulSoup      | `h1-h3`, `p`, `li`, `tr`; strips script, style, nav, footer    |
| DOCX   | python-docx        | paragraphs (headings detected from the Word style), table rows |
| XLSX   | openpyxl           | one block per non-empty row, plus sheet name and row number    |
| Images | Pillow + Tesseract | grayscale, auto-contrast, then OCR                             |

Table rows are serialized as `cell | cell | cell`. Text is normalized with Unicode NFKC, line endings are unified, and repeated blank lines and spaces are collapsed.

### 2. Versions, duplicates and replacement

The [`IngestionCatalog`](<../../Advance rag/baseline_RAG_ application 2/src/ingestion/catalog.py>) is a SQLite table of document **versions**, and the [`pipeline`](<../../Advance rag/baseline_RAG_ application 2/src/ingestion/pipeline.py>) uses it on every upload:

- Every document has a stable **logical ID**, for example `employee-policy`.
- Two hashes are taken: one of the raw bytes and one of the **normalized text**. If the normalized hash matches an existing version of the same document, the upload is **skipped as a duplicate**. That catches a re-saved file whose bytes differ but whose content is the same.
- A new version is first saved as `pending`, then chunked and indexed. Only then is it marked `active`, and the previous version is marked `superseded` _and its chunks are deleted from the index_. So the index only ever holds the current version, and nobody gets answers from the old policy.
- If chunking or indexing fails, the version is marked `failed` and its partial chunks are removed.
- Deleting a document removes its chunks from the index and marks every version `deleted`.
- Uploaded bytes are kept as immutable copies, named by content hash, so every version keeps its source.

### 3. Three chunking strategies

| Chunker        | How it splits                                                                                                                                                                                                                                                                   | Best for                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **Structural** | Starts a new chunk at every heading, and caps chunks at ~900 characters. Each chunk records its `heading_path`.                                                                                                                                                                 | Documents with good headings             |
| **Recursive**  | ~700-character windows that try to cut at a paragraph break, then a newline, then `. `, `; `, `, ` and finally a space, with a 100-character overlap.                                                                                                                           | General text                             |
| **Semantic**   | Splits text into sentences and embeds each one with MiniLM. A cut happens when the cosine similarity between neighbouring sentences drops below 0.15 (with at least 2 and at most 8 sentences per chunk). Sentence embeddings are cached in SQLite by `(model, sentence hash)`. | Text that changes topic without headings |

### 4. Parent–child chunks

The [`ParentChildMapper`](<../../Advance rag/baseline_RAG_ application 2/src/chunking/parent_child.py>) groups every 3 consecutive "child" chunks under one "parent". **Search runs on the small children** (precise matches), but the app can **expand to the parent** to give the LLM the surrounding context. The parent inherits filterable metadata such as department and effective date.

Chunk IDs are stable hashes of version, chunker, position and text. Re-ingesting the same content gives the same IDs, which later labs rely on: evaluation, caching and graph provenance all point to chunk IDs.

---

## Lab 3 — Hybrid retrieval and reranking (also in `baseline_RAG_ application 2`)

**Goal:** fix the two big retrieval failures from Lab 1. Embeddings miss exact codes and acronyms, and keywords miss paraphrases. The fix is to use both and then rerank.

### Two indexes kept in sync

- **Lexical:** SQLite FTS5 ([`lexical/index.py`](<../../Advance rag/baseline_RAG_ application 2/src/retrieval/lexical/index.py>)). Each chunk is indexed twice: as raw text, and as "normalized" text containing only letters and digits, lowercased. So `NX-742-A` becomes `nx 742 a`, and a phrase query on the normalized column matches the identifier however it is punctuated. The query is built as the exact phrase, OR each token in either column. Scores are BM25.
- **Vector:** Qdrant ([`vector/index.py`](<../../Advance rag/baseline_RAG_ application 2/src/retrieval/vector/index.py>)). Each point ID is a UUIDv5 of the chunk ID, so re-indexing is idempotent.
- **One writer:** the [`HybridIndexCoordinator`](<../../Advance rag/baseline_RAG_ application 2/src/retrieval/index_coordinator.py>) is the single ingestion sink. It embeds the chunks, writes the lexical index, then the vector index. If the vector write fails, it deletes what it just wrote to the lexical index, so the two indexes never disagree. Deletes go to both. The demo's last check is that deleting one document drops _both_ counts from 13 to 12.

### The hybrid search flow ([`hybrid.py`](<../../Advance rag/baseline_RAG_ application 2/src/retrieval/hybrid.py>))

1. Run lexical and vector search **in parallel** (a thread pool), 20 candidates each.
2. Apply **metadata filters** (department, document, media type, date range) to both. The lexical side filters inside the SQL; the vector side fetches a wider pool and filters in Python with the _same_ predicate, so both paths agree on what a filter means.
3. **Fuse** the two lists ([`fusion.py`](<../../Advance rag/baseline_RAG_ application 2/src/retrieval/fusion.py>)). Duplicates are merged by chunk ID, and the UI shows how many were merged. There are two options:
   - **Reciprocal Rank Fusion (RRF):** `score = Σ 1 / (60 + rank)`. It only uses _ranks_, so the two engines' incompatible score scales don't matter. This is the default.
   - **Weighted fusion:** min-max normalize each engine's scores to 0–1, then mix them, by default 0.4 lexical + 0.6 vector.
4. **Rerank** the top 10 with a **CrossEncoder**. A bi-encoder embeds the query and the chunk separately; a CrossEncoder reads them _together_ and scores relevance much more accurately, but it is slow, so it only runs on the short fused list. Scores are cached in SQLite by `(model, query hash, chunk ID + content hash + text)`.
5. Return the final Top 5, with timings for every stage.

**Proof in the demo:** for "What steps should staff follow for temporary administrator recovery?", the right procedure is at fusion rank 4, and reranking moves it to rank 1.

**Lab 8's numbers** show the same effect over the whole golden set (see Lab 8 below). MRR goes from 0.69 with vector only, to 0.89 with hybrid, to 0.94 with reranking.

---

## `baseline_RAG_ application 3`

This folder only contains empty `src/`, `scripts/` and `tests/` folders (empty `__pycache__` directories) and a `venv/`. There is no code or documentation in it. It looks like a failed or partial copy. You can ignore it or delete it.

---

## Lab 4 — Query intelligence (`lab04_…/src/query_engine/`)

**Goal:** users ask vague, conversational or compound questions. Lab 4 transforms the _query_ before retrieval, carefully, so that a transformation can never change the meaning of the question.

### The pipeline ([`pipeline.py`](<../../Advance rag/lab04_baseline_RAG_ application/src/query_engine/pipeline.py>))

**1. Classify** ([`classifier.py`](<../../Advance rag/lab04_baseline_RAG_ application/src/query_engine/classifier.py>)). The query gets one of 8 intents: `exact_identifier`, `conversational_followup`, `comparison`, `relationship`, `table_lookup`, `multi_part`, `vocabulary_mismatch` or `fact_lookup`.

- Regex rules run first. If they are confident (≥ 0.95), **the LLM is not called at all.**
- Otherwise Ollama classifies using **structured output**: the Pydantic model's JSON schema is passed as Ollama's `format`, at temperature 0, and the reply is validated.

**2. Protect the intent** ([`intent_guard.py`](<../../Advance rag/lab04_baseline_RAG_ application/src/query_engine/intent_guard.py>)). Regex extracts what must never be lost:

- identifiers (`NX-742-A`), quoted phrases, dates and numbers;
- departments;
- constraint words ("only", "before", "not", "at least", …).

Every later transformation is checked against this list. A rewrite that drops `NX-742-A` is rejected.

**3. Route** ([`router.py`](<../../Advance rag/lab04_baseline_RAG_ application/src/query_engine/router.py>)). This is pure Python: _"the model never controls cost limits"_. Each intent maps to a retrieval recipe:

| Intent                               | Recipe                                                               |
| ------------------------------------ | -------------------------------------------------------------------- |
| Exact identifier                     | Lexical-heavy (0.8 lexical / 0.2 vector), no expansion, no reranking |
| Conversational follow-up             | Rewrite into a standalone question, then normal hybrid RRF           |
| Vocabulary mismatch                  | Vector-heavy (0.2 / 0.8), multi-query, HyDE, reranking               |
| Comparison, relationship, multi-part | Decompose into subqueries, merge, rerank once                        |
| Table lookup                         | Lexical-heavy (0.7 / 0.3), filtered to the spreadsheet               |
| Fact lookup                          | Standard hybrid RRF with reranking                                   |

**4. Transform, only if the route asks for it:**

- **Rewrite:** "What support tier does _it_ have?" plus the previous context becomes "What support tier does NX-742-A have?".
- **Multi-query:** at most 3 paraphrased variants.
- **Decomposition:** at most 3 subqueries. Output that looks like SQL or code is rejected.
- **HyDE** (Hypothetical Document Embeddings): the LLM writes a fake answer passage (at most 800 characters), and _that text_ is embedded to search for real passages that look like it. Its schema has `use_for_vector_retrieval_only: Literal[True]`. The fake passage is only ever used as a **vector** query, never for keyword search, and it **can never appear as evidence**.

**5. Execute** ([`retrieval_executor.py`](<../../Advance rag/lab04_baseline_RAG_ application/src/query_engine/retrieval_executor.py>)):

- At most 4 retrieval queries.
- Each runs hybrid search.
- All result lists are merged with a second RRF, which records how many queries found each chunk.
- The CrossEncoder runs **once** on the merged pool, not once per query.

### Hard budgets and fallbacks

| Limit                   | Default |
| ----------------------- | ------- |
| Model calls per request | 4       |
| Retrieval queries       | 4       |
| Query variants          | 3       |
| Subqueries              | 3       |

If Ollama is down or returns invalid JSON, every component returns its deterministic result and logs a `fallback_event`. The app never fails because the model failed. Prompts live in JSON files (`prompts/*.json`), separate from the code. Every step goes into a `QueryIntelligenceTrace`: intent, rewrite, variants, HyDE text, route, model calls, fallbacks and per-stage latency.

---

## Lab 5 — Self-RAG and Corrective RAG (`lab05_…/src/adaptive_rag/`)

**Goal:** stop the system answering from weak evidence. It should check its own retrieval and its own answer, try to fix problems once, and otherwise say "I don't know".

### The workflow is a LangGraph state machine ([`graph.py`](<../../Advance rag/lab05_baseline_RAG_ application/src/adaptive_rag/graph.py>))

```
classify_query → retrieve → grade_context ─┬─ sufficient  → generate → verify_answer ─┬─ supported → finalize
                                           ├─ weak        → correct_query            ├─ not supported → correct_query (if a retry is left)
                                           │                → alternate_retrieval    └─ otherwise → abstain
                                           │                → grade_context (again)
                                           └─ unsupported → abstain
```

- **`grade_context`** ([`context_grader.py`](<../../Advance rag/lab05_baseline_RAG_ application/src/adaptive_rag/context_grader.py>)) labels the retrieved evidence `sufficient`, `weak` or `unsupported`, with relevance and coverage scores, a list of what is missing, and the supporting chunk IDs. One safety detail: when the LLM grader is used, it **may not override** a confident deterministic grade. It cannot, for example, turn "unsupported" into "sufficient".
- **`correct_query`** ([`correction.py`](<../../Advance rag/lab05_baseline_RAG_ application/src/adaptive_rag/correction.py>)) rewrites the query into the documents' vocabulary. "Get back administrator control when systems are down" becomes "restore administrator control during a service outage". It can also switch the retrieval route, for example to vector-heavy. Protected entities still apply.
- **`generate`** returns a `GroundedAnswer`, which must include the **chunk IDs** it cites.
- **`verify_answer`** ([`answer_verifier.py`](<../../Advance rag/lab05_baseline_RAG_ application/src/adaptive_rag/answer_verifier.py>)) rejects any answer that cites **no chunks or a chunk that wasn't retrieved**. Then it checks the answer's claims against the cited text.
- **`abstain`** returns a fixed "I could not find enough supported information…" answer.

### Bounded by design ([`policies.py`](<../../Advance rag/lab05_baseline_RAG_ application/src/adaptive_rag/policies.py>))

Every routing decision checks budgets first:

| Budget             | Default |
| ------------------ | ------- |
| Correction retries | 1       |
| Retrieval calls    | 3       |
| Model calls        | 6       |
| Generations        | 2       |
| Context grades     | 3       |
| Verifications      | 2       |
| Request deadline   | 20 s    |

When a budget runs out, the graph goes to `abstain`, so it can't loop forever. The whole state is one serializable Pydantic model ([`state.py`](<../../Advance rag/lab05_baseline_RAG_ application/src/adaptive_rag/state.py>)), and LangGraph **checkpoints** it under a `thread_id`, so the final state can be reloaded and inspected. Every node appends a `WorkflowEvent` (node, decision, reason, latency, calls), which the UI shows as a timeline.

---

## Lab 6 — GraphRAG on a CPU (`lab06_…/src/graph/`)

**Goal:** answer **multi-hop relationship** questions such as "Who approves the process used to restore administrator control during a service outage?". The answer is spread across two documents. Vector search finds both texts, but it can't show the _chain_ of facts.

### Building the graph, with provenance mandatory

- Facts are records like `Administrator Recovery Procedure --USES--> PAM Approval Process`, stored in `graph_records.jsonl`. **Every record must name the document and the exact chunk it came from, plus a confidence score.**
- The [`loader`](<../../Advance rag/lab06_baseline_RAG_ application/src/graph/loader.py>) rejects any record whose chunk doesn't exist, or whose chunk belongs to a different document. A graph fact without real evidence never enters the graph. The JSONL is validated and turned into a NetworkX `MultiDiGraph` each time the app starts; there is no saved graph file to drift out of date.
- **Entity resolution** ([`resolver.py`](<../../Advance rag/lab06_baseline_RAG_ application/src/graph/resolver.py>)): names are normalized (Unicode, lowercase, punctuation removed), and matched by canonical name, then aliases, then fuzzy matching (RapidFuzz, threshold 92, with an ambiguity margin of 5 that refuses close ties). So "PAM Approval Process" and "Privileged Access Management Approval Process" become one node, and "Northstar Edge Gateway" resolves to product `NX-742-A`.
- Optional **extraction** of new facts from one chunk works by simple rules, or by Ollama with a validated schema (at most 5 records per batch). Extracted facts inherit that chunk's IDs, and invalid model output adds nothing.

### Querying the graph

1. Find entities mentioned in the question, using the same resolution rules.
2. **Bounded traversal** ([`traversal.py`](<../../Advance rag/lab06_baseline_RAG_ application/src/graph/traversal.py>)): a depth-first search with these limits:

   | Limit                   | Default        |
   | ----------------------- | -------------- |
   | Depth                   | 2 (hard cap 5) |
   | Neighbors per node      | 15             |
   | Paths                   | 20             |
   | Minimum edge confidence | 0.70           |
   | Cycles                  | not allowed    |

   Each path is scored as `seed match × product of edge confidences × hop penalty × small bonus for distinct source chunks`.

3. Each path's **edges point to real chunks**. Those chunks become graph evidence.
4. **Three modes to compare:** vector only, graph only, or **combined**. Combined fuses vector candidates and graph-supported chunks with RRF and deduplicates them by chunk ID.

The result is an answer with a visible reasoning chain: _Recovery Procedure → uses → PAM Approval → approved by → Security Director_, where every arrow links to a source chunk.

---

## Lab 7 — Multimodal retrieval without a vision model (`lab07_…/src/multimodal/`)

**Goal:** search tables, scanned pages and figures in PDFs, and cite the exact spot on the original page. All of it runs on CPU, with **no** CLIP, ColPali, vision-language model or image embeddings.

### What gets extracted, and from where

| Content         | Method                                                                                                                                                                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native PDF text | PyMuPDF text blocks with **bounding boxes** and font sizes                                                                                                                                                                                                           |
| Scanned pages   | If a page has fewer than 40 native characters, it is rendered to an image and run through **Tesseract**. Words below confidence 40 are dropped. Word boxes are mapped back to PDF coordinates.                                                                       |
| Tables          | **pdfplumber** extracts the cells. The table is normalized, with headers kept attached to every row, so the row "North \| 99.91 \| 99.97" is stored together with "Region \| Q1 \| Q2". Each table is indexed whole and row by row, and also has a Markdown version. |
| Figures         | Only the **original text**: the caption, nearby paragraphs and the text labels inside the figure region. The pipeline never _generates_ a description of an image, and generated text can't be marked as original evidence.                                          |
| Pages           | A page-level record holds the whole page's context.                                                                                                                                                                                                                  |

Every record keeps document, page number, extraction method, the rendered page image and a bounding box. The two demo PDFs (5 pages) produce 37 records: pages, paragraphs, table rows, OCR lines and figures.

### Routing and citations

A small [`router`](<../../Advance rag/lab07_baseline_RAG_ application/src/multimodal/router.py>) decides by keywords:

- "table, column, Q2, region…" → **table route**: table records only, lexical-heavy;
- "figure, chart, caption…" → **figure route**;
- "why… impact… page…" → **page-context route**.

Answers come with **visual citations**: the original page image with the matching row, OCR line or paragraph highlighted. For example: "North Region Q2 availability was 99.97%", with the row highlighted on page 2.

**Key lesson:** much of "multimodal RAG" can be done well by extracting text _with its coordinates_ and keeping layout structure, before spending money on vision models.

---

## Lab 8 — Evaluation (`lab08_…/src/evaluation/`)

**Goal:** stop guessing whether a change helped. Compare configurations against a fixed **golden dataset**, using real metrics.

### The golden dataset

`golden_dataset.jsonl` has 10 cases. Each case has:

- a query and its expected answer;
- the relevant **document IDs and chunk IDs**;
- the expected citations, and whether it should abstain;
- tags such as `exact_identifier`, `table_lookup`, `multi_hop` or `unsupported`.

The setup script finds the real, stable chunk IDs before writing the file, so the dataset always matches the corpus.

### Four configurations, run on the same corpus

Baseline vector, hybrid, hybrid with reranking, and query-enhanced (Lab 4). Only the retrieval strategy changes; the corpus, K, answerer and cases stay the same.

### The metrics

- **Retrieval** ([`retrieval_metrics.py`](<../../Advance rag/lab08_baseline_RAG_ application/src/evaluation/retrieval_metrics.py>)), computed for supported cases only:

  | Metric      | Measures                                   |
  | ----------- | ------------------------------------------ |
  | Hit Rate@K  | was anything relevant found?               |
  | Recall@K    | how much of the needed evidence was found? |
  | Precision@K | how much of what was found is relevant?    |
  | MRR         | how high is the first relevant result?     |
  | nDCG@K      | are relevant results near the top?         |

- **Answers:**
  - exact match, after normalizing case, spacing, punctuation and citation suffixes;
  - fuzzy match (RapidFuzz token-set ratio ≥ 85);
  - citation correctness (are the returned citations right?) and completeness (were all expected ones returned?);
  - abstention accuracy.
- **Grounding** ([`grounding.py`](<../../Advance rag/lab08_baseline_RAG_ application/src/evaluation/grounding.py>)): each citation must be a chunk that was actually retrieved, and **every number in the answer must appear in the evidence**. This catches hallucinated figures.
- **Cost proxy:** mean and P95 latency, plus _operation counts_ (embedding, lexical, vector, fusion, rerank, transformation, generation and judge calls). No made-up dollar cost for local CPU work.
- **Optional** extras: an LLM judge (Ollama), and RAGAS (installed separately). The required run uses **no LLM judge**, so it stays deterministic.

### Real results from the saved runs (`artifacts/evaluation/…/configuration_summary.csv`)

| Configuration   | Hit@5 | Recall@5 | MRR  | nDCG@5 | Exact answer |
| --------------- | ----- | -------- | ---- | ------ | ------------ |
| Baseline vector | 1.00  | 0.94     | 0.69 | 0.72   | 0.90         |
| Hybrid          | 1.00  | 0.94     | 0.89 | 0.88   | 0.90         |
| Hybrid + rerank | 1.00  | 0.94     | 0.94 | 0.92   | 0.90         |
| Query-enhanced  | 1.00  | 0.94     | 0.94 | 0.92   | 0.90         |

Every configuration _found_ the evidence; Hit and Recall are the same for all of them. The difference is **ranking quality** (MRR and nDCG): hybrid search and reranking push the right chunk to the top. That matters, because the LLM pays most attention to the first results, and a smaller Top-K becomes safe. The one remaining failure is the two-hop case, whose second document sits below Top-5. The runbook says this honestly, as proof that "an advanced configuration doesn't fix every case".

### Regressions and reports

- Any failed case/configuration pair can be **promoted to a pytest regression**: a fixture recording the case, configuration, minimum metric thresholds, run ID and failure labels. The test keeps failing until the bug is fixed.
- Results export to CSV and JSONL, plus a Jinja2 **HTML report**.
- Failure labels are deterministic, for example `incomplete_multi_chunk_retrieval`, `missing_citation`, `answer_mismatch` and `false_abstention`.

---

## Lab 9 — Observability and optimization (`lab09_…/src/observability/`, `src/optimization/`)

**Goal:** see where time and money go in one request, make it faster and cheaper, and **prove the answer didn't get worse**.

### Observability

- **OpenTelemetry spans** for every stage, for example `retrieval.lexical`, `retrieval.vector`, `retrieval.fusion`, `rerank.cross_encoder`, `cache.lookup`, `graph.traversal` and `context.deduplicate`. Span attributes record document IDs, chunk IDs, ranks and scores, but **not the full query text** (a privacy choice).
- **Structured JSON logs** (`rag_requests.jsonl`) with `request_id`, `trace_id`, `span_id`, stage, duration and status, so logs and traces correlate.
- **Workload counters:**
  - embedding, lexical, vector, fusion and rerank calls;
  - reranked pairs;
  - prompt and output tokens (estimated when the provider doesn't report them);
  - context chunks and characters.
- An **"equivalent cost" estimate** using configurable per-million-token rates. It is clearly labelled as an estimate, not a bill.
- `docker-compose.observability.yml` runs Jaeger, the API and the UI as three containers, and exports traces over OTLP. One trace then spans **UI HTTP client → FastAPI → every RAG stage**.

### Optimizations, each one measurable

| Technique                                                                                                                                               | How it works                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Adaptive Top-K** ([`adaptive_top_k.py`](<../../Advance rag/lab09_baseline_RAG_ application/src/optimization/adaptive_top_k.py>))                      | Top-K depends on intent: 3 for an exact ID or table lookup, 5 for a fact, 6 for vocabulary mismatch, 8 for comparison and multi-hop. It can grow by 2 if the evidence check fails.                                                                                                                         |
| **Conditional reranking** ([`conditional_reranking.py`](<../../Advance rag/lab09_baseline_RAG_ application/src/optimization/conditional_reranking.py>)) | Skip the CrossEncoder when there are fewer than 3 candidates, when an exact identifier is already lexical rank 1, when the top fused score leads the next by ≥ 25%, or when less than 150 ms of the deadline is left. Always rerank for uncertain intents (comparison, relationship, vocabulary mismatch). |
| **Retrieval cache** ([`cache.py`](<../../Advance rag/lab09_baseline_RAG_ application/src/optimization/cache.py>))                                       | SQLite, 15-minute TTL. The key hashes the **corpus hash**, the normalized queries, the strategy, the depth, the embedding model, the fusion settings and the filters, so any corpus or config change invalidates it automatically. A warm hit skips lexical, vector and fusion entirely.                   |
| **Context deduplication**                                                                                                                               | Removes repeated chunks or text before the prompt is built, so there are fewer tokens.                                                                                                                                                                                                                     |
| **Deadlines**                                                                                                                                           | One request-wide budget. Steps check the remaining time, and running out means a safe abstention plus an error span (`deadline_exceeded`), never a half-answer.                                                                                                                                            |

### The quality gate

An optimized profile is accepted only if, compared to the original, the **answer matches, the citations match and the relevant evidence is preserved**. In the demo, the original profile uses Top-K 10 and reranks 10 pairs. The optimized profile uses Top-K 6 and reranks 6 pairs; its warm run hits the cache, does fewer operations and is faster, and the gate passes. As the runbook puts it, a latency improvement on its own is not enough.

---

## The patterns worth copying

Across all nine labs, these are the habits that make this "advanced" RAG rather than a demo:

1. **Measure first.** Lab 1's benchmark names the failure types, and Lab 8 turns that into metrics and regression tests. Every feature is justified by a number.
2. **Hybrid search plus reranking is the biggest single quality win.** Keywords for codes and acronyms, vectors for paraphrases, RRF to merge them, and a CrossEncoder on the short list.
3. **Stable IDs everywhere.** Chunk IDs are hashes of version and content, so evaluation, caching, citations and graph provenance all point to the same thing.
4. **Version-aware ingestion.** Hash the content, skip duplicates, replace the old version atomically, delete it from every index.
5. **Two indexes, one writer.** One coordinator writes both indexes and rolls back on failure.
6. **Protect the user's intent.** Identifiers, numbers, dates and constraints must survive every rewrite, or the rewrite is rejected.
7. **Python decides, the model suggests.** Routing, budgets, retries and deadlines are code. The LLM only produces validated structured output, with deterministic fallbacks.
8. **Synthetic text is never evidence.** HyDE passages, rewrites and generated descriptions are for retrieval only. Citations must be chunks that were really retrieved, and numbers must appear in them.
9. **Every loop is bounded.** Retry counts, call budgets, depth limits, path limits and deadlines all end in abstention, not an endless loop.
10. **Abstaining is a feature.** "I couldn't find this" is scored as a _correct_ answer when the corpus doesn't support the question.
11. **Provenance on everything.** Graph edges, table rows, OCR lines and figures all point back to a document, page, chunk and bounding box.
12. **Optimize only behind a quality gate.** Faster is accepted only if the answer, citations and evidence are unchanged.

## Things to keep in mind (limits of the course code)

These projects are teaching code, built to make demos reproducible. Some parts would need work before production:

- **Many deterministic rules are fitted to the demo corpus.** The fixture answer generator matches specific questions ("annual leave", "Project Atlas"). The classifier's vocabulary-mismatch regex looks for words like "downtime" and "regain". The deterministic HyDE text describes the admin-recovery procedure. The table route hard-codes the `product-catalog` document. With real data, these become the LLM path plus general rules.
- **Single process, local state.** In-memory Qdrant, SQLite files and Streamlit session state, with no users, no tenants and no authentication. The Streamlit workspaces reset on restart.
- **The vector filter runs after search.** It fetches a larger pool and filters in Python, which is fine for 14 chunks. At scale, the filter should run inside the vector database's query.
- **Tiny corpus and golden set.** 13–14 chunks and 10 cases. The numbers show direction, not statistical proof.
- **Dependencies use loose `>=` ranges, and the Jaeger image is `latest`.** Neither is reproducible over time.

## How this maps to Chatlium

Chatlium (this repository) is a multi-tenant RAG support chat in TypeScript, using Postgres with pgvector and RLS, Gemini and SQS. These are the course ideas that fit its build guide most directly:

| Course idea                                                                                   | Where it could land in Chatlium                                                                          |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Version-aware ingestion with content hashing (Lab 2)                                          | The indexing worker from Step 2.5: skip unchanged re-uploads, replace old chunks when a document changes |
| Structural, recursive or parent-child chunking (Lab 2)                                        | Indexing worker chunker choice                                                                           |
| Hybrid search: Postgres full-text (`tsvector`, BM25-like) + pgvector, merged with RRF (Lab 3) | Retrieval step. Both live in the same Postgres, and both are covered by the same RLS policies            |
| Reranking the short list (Lab 3)                                                              | After retrieval, before the prompt                                                                       |
| Intent guard and bounded query rewriting (Lab 4)                                              | Follow-up questions in a chat conversation ("what about _it_?")                                          |
| Grade context, then abstain or escalate (Lab 5)                                               | Chatlium's escalation to a human operator is the natural "abstain" branch                                |
| Citations must be real retrieved chunk IDs; numbers must be in the evidence (Labs 5, 8)       | Answer validation before streaming to the widget                                                         |
| Golden dataset, retrieval metrics, regression tests (Lab 8)                                   | An evaluation suite in CI                                                                                |
| OpenTelemetry spans per RAG stage, token and cost counters (Lab 9)                            | Chatlium already plans OTel + Tempo + Grafana; the span names and counters here are a good template      |
| Retrieval cache keyed by corpus hash (Lab 9)                                                  | A Redis cache, keyed per workspace                                                                       |
