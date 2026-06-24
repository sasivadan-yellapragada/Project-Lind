"""
Clinical Trials Fetcher
=======================
A command-line application that retrieves clinical trial information
from the ClinicalTrials.gov API v2 using a valid NCT ID.

Usage:
    python clinical_trials.py <NCT_ID>

Example:
    python clinical_trials.py NCT04280705
"""

import sys
import requests


BASE_URL = "https://clinicaltrials.gov/api/v2/studies"


def fetch_study(nct_id: str) -> dict:
    """
    Fetch a single study from ClinicalTrials.gov API v2.

    Args:
        nct_id: A valid NCT identifier (e.g. "NCT04280705").

    Returns:
        The parsed JSON response as a dictionary.

    Raises:
        requests.exceptions.HTTPError: If the API returns a non-2xx status.
        requests.exceptions.ConnectionError: If the network is unreachable.
        requests.exceptions.Timeout: If the request times out.
    """
    url = f"{BASE_URL}/{nct_id}"
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    return response.json()


def extract_trial_info(data: dict) -> dict:
    """
    Extract key trial details from the raw API response.

    The ClinicalTrials.gov v2 response nests everything under
    ``protocolSection``.  We pull out four fields:

    - **Title** from ``identificationModule.briefTitle``
    - **Phase** from ``designModule.phases`` (list → comma-joined string)
    - **Status** from ``statusModule.overallStatus``
    - **Sponsor** from ``sponsorCollaboratorsModule.leadSponsor.name``

    Args:
        data: The full JSON dict returned by the API.

    Returns:
        A dict with keys ``title``, ``phase``, ``status``, ``sponsor``.
    """
    protocol = data.get("protocolSection", {})

    # --- Title ---
    identification = protocol.get("identificationModule", {})
    title = identification.get("briefTitle", "N/A")

    # --- Phase ---
    design = protocol.get("designModule", {})
    phases = design.get("phases", [])
    phase = ", ".join(phases) if phases else "N/A"

    # --- Status ---
    status_module = protocol.get("statusModule", {})
    status = status_module.get("overallStatus", "N/A")

    # --- Sponsor ---
    sponsor_module = protocol.get("sponsorCollaboratorsModule", {})
    lead_sponsor = sponsor_module.get("leadSponsor", {})
    sponsor = lead_sponsor.get("name", "N/A")

    return {
        "title": title,
        "phase": phase,
        "status": status,
        "sponsor": sponsor,
    }


def display_trial(nct_id: str, info: dict) -> None:
    """Pretty-print trial information to stdout."""
    border = "=" * 60
    print(f"\n{border}")
    print(f"  Clinical Trial Details  —  {nct_id}")
    print(border)
    print(f"  Title   : {info['title']}")
    print(f"  Phase   : {info['phase']}")
    print(f"  Status  : {info['status']}")
    print(f"  Sponsor : {info['sponsor']}")
    print(f"{border}\n")


def main() -> None:
    """Entry point: parse CLI args, fetch, extract, and display."""
    if len(sys.argv) != 2:
        print("Usage: python clinical_trials.py <NCT_ID>")
        print("Example: python clinical_trials.py NCT04280705")
        sys.exit(1)

    nct_id = sys.argv[1].strip().upper()

    # Basic format validation
    if not nct_id.startswith("NCT") or not nct_id[3:].isdigit():
        print(f"Error: '{nct_id}' does not look like a valid NCT ID.")
        print("NCT IDs follow the pattern NCT followed by digits (e.g. NCT04280705).")
        sys.exit(1)

    print(f"Fetching trial data for {nct_id} …")

    try:
        data = fetch_study(nct_id)
    except requests.exceptions.HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else "unknown"
        if status_code == 404:
            print(f"Error: No study found for NCT ID '{nct_id}'.")
        else:
            print(f"Error: API returned HTTP {status_code}.")
        sys.exit(1)
    except requests.exceptions.ConnectionError:
        print("Error: Unable to connect to ClinicalTrials.gov. Check your internet connection.")
        sys.exit(1)
    except requests.exceptions.Timeout:
        print("Error: Request to ClinicalTrials.gov timed out. Try again later.")
        sys.exit(1)
    except requests.exceptions.RequestException as exc:
        print(f"Error: An unexpected error occurred — {exc}")
        sys.exit(1)

    info = extract_trial_info(data)
    display_trial(nct_id, info)


if __name__ == "__main__":
    main()
