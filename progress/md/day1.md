# Day 1 — Project Setup & First Contact

**Date**: 2026-06-24

## What I Did

- Initialized the project repository with Git.
- Explored the ClinicalTrials.gov API v2 documentation and tested the `/studies/{nctId}` endpoint.
- Built `clinical_trials.py` — a CLI tool that:
  - Accepts an NCT ID as a command-line argument.
  - Validates the NCT ID format.
  - Fetches study data from the ClinicalTrials.gov API v2.
  - Extracts and displays Trial Title, Phase, Status, and Sponsor.
  - Handles errors gracefully (invalid ID, 404, network issues, timeouts).
- Created `requirements.txt` with the `requests` dependency.
- Wrote a comprehensive `README.md` with setup instructions, usage examples, and project documentation.
- Set up `.gitignore` for Python projects.

## What I Learned

- The ClinicalTrials.gov API v2 returns deeply nested JSON under `protocolSection`.
- Key modules in the response:
  - `identificationModule` → trial title, NCT ID, organization
  - `statusModule` → overall status, dates
  - `designModule` → phases, study type, enrollment
  - `sponsorCollaboratorsModule` → lead sponsor info
- The API is public and requires no authentication.
- Phases are returned as a list (e.g., `["PHASE3"]`), not a single string.

## Blockers

None.

## Next Steps

- Add support for querying multiple trials or searching by keyword.
- Explore additional fields (conditions, interventions, eligibility).
- Add unit tests.
