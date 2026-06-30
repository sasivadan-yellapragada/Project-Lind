# Clinical Trials Fetcher (Level 1 - Ingest & Store)

A Python command-line application that retrieves clinical trial information from the [ClinicalTrials.gov API v2](https://clinicaltrials.gov/data-api/api) and stores it locally for analysis.

## Features

- **Configurable Bulk Ingestion**: Fetch thousands of trials for any therapeutic area or condition via a single command.
- **Automated Pagination**: Automatically handles API pagination to pull the entire corpus for your query.
- **Normalized SQLite Storage**: Stores trial data in a normalized local SQLite database (`trials.db`), including:
  - `trials` table (NCT ID, Title, Phase, Status, Sponsor, Dates, Enrollment, Summaries).
  - `trial_conditions` table (linked to `trials`).
  - `trial_interventions` table (linked to `trials`).
- **Incremental Sync / Idempotency**: Automatically skips unchanged records and updates modified records on subsequent runs.
- **Validation**: Spot-checks the local database record count against the total reported by the ClinicalTrials.gov API.
- **CLI Query Engine**: Query the local database dynamically by phase, status, sponsor, and condition.

### Database Architecture Decision
While a centralized RDBMS like MySQL or PostgreSQL was considered, **SQLite** was intentionally chosen for Level 1.
- **Why SQLite is enough for L1:** L1 focuses on local, single-user data ingestion and querying. SQLite provides zero-configuration, file-based storage that makes setup trivial while still supporting full SQL querying and relational structure (e.g., child tables for conditions and interventions).
- **Alternatives considered:** MySQL and PostgreSQL were considered but would require additional infrastructure setup (like Docker or a hosted database instance) which adds unnecessary friction for a local validation script.
- **When to revisit:** We will revisit this choice and likely migrate to PostgreSQL or MySQL when moving to a production environment where concurrent data ingestion, web backend scaling, or multi-user access is required.

## Prerequisites

- Python 3.8+
- `requests` library

## Setup

```bash
# Clone the repository
git clone <repository-url>
cd lind_1

# (Optional) Create a virtual environment
python3 -m venv venv
source venv/bin/activate   # macOS / Linux

# Install dependencies
pip install -r requirements.txt
```

## Usage

The application provides two subcommands: `ingest` and `query`.

### 1. Ingest Data
Ingest trials by specifying a therapeutic condition.

```bash
python clinical_trials.py ingest --condition "non-small cell lung cancer"
```

*This will fetch the trials and populate `trials.db`. The script supports idempotency; if you run it again, it will gracefully skip existing unmodified records.*

### 2. Query Local Database
Query the local SQLite database for specific criteria using combination filters.

```bash
python clinical_trials.py query --phase PHASE3 --status RECRUITING --sponsor Pfizer --condition "lung cancer"
```

#### Available Filters:
- `--phase`: Filter by trial phase (e.g., `PHASE3`, `PHASE1`)
- `--status`: Filter by recruitment status (e.g., `RECRUITING`, `COMPLETED`)
- `--sponsor`: Filter by lead sponsor name (e.g., `Pfizer`)
- `--condition`: Filter by trial condition (e.g., `lung cancer`)

## Project Structure

```
lind_1/
├── clinical_trials.py   # Main CLI application (Ingest & Query)
├── trials.db            # Local SQLite database (Generated after ingest)
├── requirements.txt     # Python dependencies
├── progress/            # Documentation & PRDs
│   └── md/
│       ├── day1.md
│       ├── Daily_update_Day4.md
│       └── Level1_PRD.md
├── .gitignore
└── README.md            # This file
```

## API Reference

This project uses the **ClinicalTrials.gov API v2**:

- **Endpoint**: `GET https://clinicaltrials.gov/api/v2/studies`
- **Documentation**: https://clinicaltrials.gov/data-api/api

### Reproducible Validation Query
To reproduce the validation logic natively against the API:
- **Target Therapeutic Area (Validation)**: `"non-small cell lung cancer"`
- **Exact API URL**: `https://clinicaltrials.gov/api/v2/studies?query.cond=non-small+cell+lung+cancer&pageSize=1000&fields=protocolSection&countTotal=true`
- **Count Timestamp**: *2026-06-30 11:30:00 IST*

## License

This project is for educational purposes as part of the ZoomRx internship program (Project Lind).
