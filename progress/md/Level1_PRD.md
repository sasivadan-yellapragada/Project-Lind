# Level 1 PRD — Ingest & Store

## Goal

Build a complete **ETL (Extract, Transform, Load)** pipeline that retrieves all clinical trials for a selected therapeutic area from the ClinicalTrials.gov API, normalizes the data into a relational **SQLite** database, and provides a Command Line Interface (CLI) for executing structured queries against the stored dataset.

---

# Approach

## Technology Stack

| Component | Technology |
|------------|------------|
| Programming Language | Python 3.11+ |
| HTTP Client | `requests` |
| Database | SQLite |
| Database Driver | `sqlite3` (built-in) |
| CLI | `argparse` |
| Environment Variables | `python-dotenv` |
| Logging | Python `logging` module |
| Data Validation | Optional (`Pydantic`) |

### Database Architecture Decision
While a centralized RDBMS like MySQL or PostgreSQL was considered, **SQLite** was intentionally chosen for Level 1. SQLite provides zero-configuration, file-based storage that makes setup trivial while still supporting full SQL querying and relational structure. This removes the friction of infrastructure setup for local validation scripts. We will revisit MySQL/PostgreSQL if we move to a production environment requiring concurrent data ingestion or a scaled web backend.

---

# High-Level Architecture

```text
ClinicalTrials.gov API
        │
        ▼
 API Client (Python)
        │
        ▼
Pagination Controller
        │
        ▼
Data Cleaner / Normalizer
        │
        ▼
   SQLite Database
        │
        ▼
 Query CLI (clinical_trials.py)
```

---

# Project Workflow

The application consists of five major modules:

1. Fetch data from ClinicalTrials.gov
2. Normalize and validate the response
3. Store the cleaned data in SQLite
4. Prevent duplicate records
5. Query the stored dataset through a CLI

---

# Step 1 – Select a Therapeutic Area

The ingestion process starts by selecting a disease or condition.

Example:

```bash
python clinical_trials.py ingest --condition "Type 2 Diabetes"
```

---

# Step 2 – Fetch Clinical Trials

The API Client is responsible for:

- Building API request URLs
- Sending HTTP GET requests
- Parsing JSON responses
- Retrying failed requests
- Handling connection errors

---

# Step 3 – Handle Pagination

The API returns results in batches. Continue requesting pages until no additional pages remain.

Example console output:

```text
Fetching Page 1...
100 Studies Retrieved

Fetching Page 2...
100 Studies Retrieved

Fetching Page 3...
86 Studies Retrieved

Finished
Total Studies Retrieved: 286
```

---

# Step 4 – Normalize Trial Data

Extract only the required fields.

## Structured Fields

- NCT ID
- Study Title
- Phase
- Recruitment Status
- Sponsor
- Start Date
- Completion Date
- Enrollment

## Multi-Valued Fields

- Conditions
- Interventions

These are stored in separate tables.

## Unstructured Fields

- Brief Summary
- Detailed Description
- Eligibility Criteria

These are preserved for later semantic search.

---

# Step 5 – Validate Data

Before insertion:

- Ensure NCT ID exists
- Convert empty values to NULL
- Format dates
- Remove duplicate conditions/interventions
- Trim whitespace
- Skip invalid records

---

# Step 6 – Store Data in SQLite

## Tables

### trials

- id
- nct_id (unique)
- title
- phase
- status
- sponsor
- start_date
- completion_date
- enrollment
- brief_summary
- detailed_description
- eligibility

### conditions

- id
- trial_id
- condition_name

### interventions

- id
- trial_id
- intervention_name
- intervention_type

---

# Step 7 – Prevent Duplicate Records

Use the NCT ID as the unique identifier.

- If the trial exists → Update
- Otherwise → Insert

---

# Step 8 – Build the Query CLI

Example commands:

```bash
python clinical_trials.py query --phase "Phase 3"
python clinical_trials.py query --status Recruiting
python clinical_trials.py query --sponsor Pfizer
python clinical_trials.py query --condition "Type 2 Diabetes"
python clinical_trials.py query --phase "Phase 3" --status Recruiting
```

---

# Step 9 – Logging

Example:

```text
Connected to SQLite
Fetching Page 1...
Inserted 100 Studies
Fetching Page 2...
Updated 20 Studies
Inserted 80 Studies
Completed
Total Studies Processed: 200
Errors: 0
```

---

# Project Folder Structure

```text
lind_1/
│
├── clinical_trials.py   # Main CLI application (Ingest & Query)
├── trials.db            # Local SQLite database (Generated after ingest)
├── requirements.txt     # Python dependencies
├── progress/            # Daily progress updates
├── .gitignore
└── README.md
```

---

# Completion Criteria

- Retrieve all matching clinical trials.
- Implement pagination.
- Normalize and validate data.
- Store structured and unstructured fields in SQLite.
- Prevent duplicate records.
- Provide a working CLI.
- Validate results against ClinicalTrials.gov.

---

# Risks

- API schema changes
- Missing fields
- Duplicate records
- Large datasets
- Pagination issues

---

# Stretch Goal

Implement incremental synchronization:

- Detect new studies
- Update modified studies
- Insert only new studies
- Keep the local database synchronized efficiently
