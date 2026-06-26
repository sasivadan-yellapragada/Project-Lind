# Clinical Trials Fetcher

A Python command-line application that retrieves clinical trial information from the [ClinicalTrials.gov API v2](https://clinicaltrials.gov/data-api/api) using a valid **NCT ID**.

## Features

- Fetches study data from the ClinicalTrials.gov REST API v2 endpoint.
- Extracts and displays:
  - **Trial Title**
  - **Trial Phase**
  - **Trial Status**
  - **Trial Sponsor**
- Validates NCT ID format before making the request.
- Handles API errors gracefully (invalid/not-found/API errors, network issues, timeouts).

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

```bash
python clinical_trials.py <NCT_ID>
```

### Example

```bash
python clinical_trials.py NCT04280705
```

**Output:**

```
Fetching trial data for NCT04280705 …

============================================================
  Clinical Trial Details  —  NCT04280705
============================================================
  Title   : Adaptive COVID-19 Treatment Trial (ACTT)
  Phase   : PHASE3
  Status  : COMPLETED
  Sponsor : National Institute of Allergy and Infectious Diseases (NIAID)
============================================================
```

## Error Handling

| Scenario | Message |
|---|---|
| Invalid NCT ID format | `Error: 'XYZ' does not look like a valid NCT ID.` |
| Study not found / API error (404/400) | `Error: No study found for NCT ID 'NCT00000000'.` or `Error: API returned HTTP 400.` |
| No internet connection | `Error: Unable to connect to ClinicalTrials.gov.` |
| Request timeout | `Error: Request to ClinicalTrials.gov timed out.` |

## Project Structure

```
lind_1/
├── clinical_trials.py   # Main CLI application
├── requirements.txt     # Python dependencies
├── progress/            # Daily progress updates
│   └── day1.md
├── .gitignore
└── README.md            # This file
```

## API Reference

This project uses the **ClinicalTrials.gov API v2**:

- **Endpoint**: `GET https://clinicaltrials.gov/api/v2/studies/{nctId}`
- **Documentation**: https://clinicaltrials.gov/data-api/api

## License

This project is for educational purposes as part of the ZoomRx internship program (Project Lind).
