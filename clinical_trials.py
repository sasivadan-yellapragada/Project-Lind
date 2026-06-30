import argparse
import json
import sqlite3
import sys
import requests
from datetime import datetime

BASE_URL = "https://clinicaltrials.gov/api/v2/studies"
DB_NAME = "trials.db"

def setup_db(conn):
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS trials (
            nct_id TEXT PRIMARY KEY,
            title TEXT,
            phase TEXT,
            status TEXT,
            sponsor TEXT,
            start_date TEXT,
            completion_date TEXT,
            enrollment INTEGER,
            brief_summary TEXT,
            detailed_description TEXT,
            eligibility_criteria TEXT,
            last_update_date TEXT,
            raw_json TEXT
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS trial_conditions (
            nct_id TEXT,
            condition_name TEXT,
            PRIMARY KEY (nct_id, condition_name),
            FOREIGN KEY (nct_id) REFERENCES trials(nct_id)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS trial_interventions (
            nct_id TEXT,
            intervention_type TEXT,
            intervention_name TEXT,
            PRIMARY KEY (nct_id, intervention_type, intervention_name),
            FOREIGN KEY (nct_id) REFERENCES trials(nct_id)
        )
    ''')
    conn.commit()

def ingest_trials(args):
    condition = args.condition
    print(f"Starting ingestion for condition: '{condition}'...")
    conn = sqlite3.connect(DB_NAME)
    setup_db(conn)
    cursor = conn.cursor()

    params = {
        "query.cond": condition,
        "pageSize": 1000,
        "fields": "protocolSection",
        "countTotal": "true"
    }

    inserted = 0
    updated = 0
    skipped = 0

    next_page_token = None
    page = 1
    api_total_count = None

    while True:
        if next_page_token:
            params["pageToken"] = next_page_token

        print(f"Fetching page {page}...")
        response = requests.get(BASE_URL, params=params, timeout=60)
        response.raise_for_status()
        data = response.json()
        
        if api_total_count is None:
            api_total_count = data.get("totalCount", "Unknown")

        studies = data.get("studies", [])

        for study in studies:
            protocol = study.get("protocolSection", {})
            
            # Extract fields
            id_module = protocol.get("identificationModule", {})
            nct_id = id_module.get("nctId")
            if not nct_id:
                continue

            title = id_module.get("briefTitle")
            
            design_module = protocol.get("designModule", {})
            phases = design_module.get("phases", [])
            phase = ", ".join(phases) if phases else None
            
            status_module = protocol.get("statusModule", {})
            status = status_module.get("overallStatus")
            
            sponsor_module = protocol.get("sponsorCollaboratorsModule", {})
            sponsor = sponsor_module.get("leadSponsor", {}).get("name")
            
            start_date = status_module.get("startDateStruct", {}).get("date")
            completion_date = status_module.get("primaryCompletionDateStruct", {}).get("date")
            enrollment = design_module.get("enrollmentInfo", {}).get("count")
            
            desc_module = protocol.get("descriptionModule", {})
            brief_summary = desc_module.get("briefSummary")
            detailed_description = desc_module.get("detailedDescription")
            
            eligibility = protocol.get("eligibilityModule", {}).get("eligibilityCriteria")
            
            last_update_date = status_module.get("lastUpdatePostDateStruct", {}).get("date")
            raw_json = json.dumps(study)

            # Check for idempotency
            cursor.execute("SELECT last_update_date FROM trials WHERE nct_id = ?", (nct_id,))
            row = cursor.fetchone()

            is_insert = False
            is_update = False

            if row is None:
                is_insert = True
            elif row[0] != last_update_date:
                is_update = True
            else:
                skipped += 1
                continue

            if is_insert or is_update:
                cursor.execute('''
                    INSERT INTO trials (
                        nct_id, title, phase, status, sponsor, start_date, completion_date,
                        enrollment, brief_summary, detailed_description, eligibility_criteria,
                        last_update_date, raw_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(nct_id) DO UPDATE SET
                        title=excluded.title,
                        phase=excluded.phase,
                        status=excluded.status,
                        sponsor=excluded.sponsor,
                        start_date=excluded.start_date,
                        completion_date=excluded.completion_date,
                        enrollment=excluded.enrollment,
                        brief_summary=excluded.brief_summary,
                        detailed_description=excluded.detailed_description,
                        eligibility_criteria=excluded.eligibility_criteria,
                        last_update_date=excluded.last_update_date,
                        raw_json=excluded.raw_json
                ''', (
                    nct_id, title, phase, status, sponsor, start_date, completion_date,
                    enrollment, brief_summary, detailed_description, eligibility,
                    last_update_date, raw_json
                ))

                # Handle child tables
                cursor.execute("DELETE FROM trial_conditions WHERE nct_id = ?", (nct_id,))
                conditions = protocol.get("conditionsModule", {}).get("conditions", [])
                for cond in conditions:
                    cursor.execute('''
                        INSERT OR IGNORE INTO trial_conditions (nct_id, condition_name)
                        VALUES (?, ?)
                    ''', (nct_id, cond))

                cursor.execute("DELETE FROM trial_interventions WHERE nct_id = ?", (nct_id,))
                interventions = protocol.get("armsInterventionsModule", {}).get("interventions", [])
                for inv in interventions:
                    inv_type = inv.get("type")
                    inv_name = inv.get("name")
                    if inv_type and inv_name:
                        cursor.execute('''
                            INSERT OR IGNORE INTO trial_interventions (nct_id, intervention_type, intervention_name)
                            VALUES (?, ?, ?)
                        ''', (nct_id, inv_type, inv_name))

                if is_insert:
                    inserted += 1
                else:
                    updated += 1
        
        conn.commit()

        next_page_token = data.get("nextPageToken")
        if not next_page_token:
            break
        page += 1

    # Validation outputs
    local_api_count = inserted + updated + skipped

    cursor.execute("SELECT COUNT(*) FROM trials WHERE phase LIKE '%PHASE3%' AND status = 'RECRUITING'")
    example_filtered = cursor.fetchone()[0]

    cursor.execute('''
        SELECT 
            ROUND(100.0 * SUM(CASE WHEN brief_summary IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 2),
            ROUND(100.0 * SUM(CASE WHEN detailed_description IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 2),
            ROUND(100.0 * SUM(CASE WHEN eligibility_criteria IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 2)
        FROM trials
    ''')
    coverage = cursor.fetchone()

    cursor.execute('''
        SELECT ROUND(100.0 * COUNT(DISTINCT nct_id) / (SELECT COUNT(*) FROM trials), 2)
        FROM trial_conditions
    ''')
    condition_coverage_res = cursor.fetchone()
    condition_coverage = condition_coverage_res[0] if condition_coverage_res[0] is not None else 0

    conn.close()

    print("\n--- Ingestion Complete ---")
    print(f"Inserted: {inserted}")
    print(f"Updated : {updated}")
    print(f"Skipped : {skipped}")
    print("\n--- Validation Outputs ---")
    print(f"Total trials fetched/stored for this API query: {local_api_count}")
    print(f"Total reported by ClinicalTrials.gov API: {api_total_count}")
    if str(local_api_count) == str(api_total_count) or (isinstance(api_total_count, int) and local_api_count >= api_total_count):
        print("✅ Spot-check passed: Local fetched count meets or exceeds API total count.")
    else:
        print("⚠️ Note: Local fetched count differs from API total count.")
    print(f"Phase 3 Recruiting trials in DB: {example_filtered}")
    print(f"Field Coverage:")
    print(f"  Condition Table      : {condition_coverage}%")
    print(f"  Brief Summary        : {coverage[0] if coverage[0] is not None else 0}%")
    print(f"  Detailed Description : {coverage[1] if coverage[1] is not None else 0}%")
    print(f"  Eligibility Criteria : {coverage[2] if coverage[2] is not None else 0}%")

def query_trials(args):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    query = "SELECT DISTINCT t.nct_id, t.title, t.phase, t.status, t.sponsor FROM trials t"
    params = []

    if args.condition:
        query += " JOIN trial_conditions tc ON t.nct_id = tc.nct_id"
    
    query += " WHERE 1=1"
    
    if args.condition:
        query += " AND tc.condition_name LIKE ?"
        params.append(f"%{args.condition}%")

    if args.phase:
        query += " AND t.phase LIKE ?"
        params.append(f"%{args.phase}%")
    
    if args.status:
        query += " AND t.status = ?"
        params.append(args.status)
        
    if args.sponsor:
        query += " AND t.sponsor LIKE ?"
        params.append(f"%{args.sponsor}%")

    cursor.execute(query, params)
    results = cursor.fetchall()
    
    print(f"Found {len(results)} matching trials:\n")
    for row in results:
        print(f"NCT ID  : {row[0]}")
        print(f"Title   : {row[1]}")
        print(f"Phase   : {row[2]}")
        print(f"Status  : {row[3]}")
        print(f"Sponsor : {row[4]}")
        print("-" * 60)

    conn.close()

def main():
    parser = argparse.ArgumentParser(description="Clinical Trials Ingestion and Query CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Ingest command
    ingest_parser = subparsers.add_parser("ingest", help="Ingest trials from ClinicalTrials.gov")
    ingest_parser.add_argument("--condition", required=True, help="Therapeutic area or condition to fetch (e.g., 'non-small cell lung cancer')")

    # Query command
    query_parser = subparsers.add_parser("query", help="Query the local SQLite database")
    query_parser.add_argument("--phase", help="Filter by Phase (e.g., PHASE3)")
    query_parser.add_argument("--status", help="Filter by Status (e.g., RECRUITING)")
    query_parser.add_argument("--sponsor", help="Filter by Sponsor (e.g., Pfizer)")
    query_parser.add_argument("--condition", help="Filter by Condition (e.g., 'lung cancer')")

    args = parser.parse_args()

    if args.command == "ingest":
        ingest_trials(args)
    elif args.command == "query":
        query_trials(args)

if __name__ == "__main__":
    main()
