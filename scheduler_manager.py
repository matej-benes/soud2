import sqlite3
from datetime import datetime, timedelta
from apscheduler.schedulers.background import BackgroundScheduler
from database import DB_FILE, send_odorik_sms
from ai_engine import generate_ai_analysis, generate_sms_content, get_judge_for_department

scheduler = BackgroundScheduler()

def process_case_phases(case_id: int):
    """
    Simuluje postup řízení v průběhu času a rozesílá SMS.
    """
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT case_number, department, applicant_name, applicant_phone, spouse_name, spouse_phone, other_parties, description, status FROM cases WHERE id = ?", (case_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return
    
    case_data = {
        "case_number": row[0],
        "department": row[1],
        "applicant_name": row[2],
        "applicant_phone": row[3],
        "spouse_name": row[4],
        "spouse_phone": row[5],
        "other_parties": row[6],
        "description": row[7]
    }
    current_status = row[9]
    
    if current_status == "Zahájeno (Probíhá šetření)":
        # Přechod do fáze verdiktu
        verdict_text = generate_ai_analysis(case_data, "verdikt")
        cursor.execute("UPDATE cases SET status = ?, verdict = ? WHERE id = ?", ("Ukončeno - Vydán rozsudek", verdict_text, case_id))
        conn.commit()
        
        # Odeslání SMS o ukončení
        if case_data["applicant_phone"]:
            send_odorik_sms(case_data["applicant_phone"], generate_sms_content("applicant", case_data, "verdikt"), case_data["case_number"], case_data["applicant_name"])
        if case_data["spouse_phone"]:
            send_odorik_sms(case_data["spouse_phone"], generate_sms_content("spouse", case_data, "verdikt"), case_data["case_number"], case_data["spouse_name"])
            
    conn.close()

def schedule_case_workflow(case_id: int, duration_minutes: int = 2):
    """
    Naplánuje posun stavu případu (v demo režimu např. za 2 minuty, v reálnu lze nastavit na dny).
    """
    run_date = datetime.now() + timedelta(minutes=duration_minutes)
    scheduler.add_job(process_case_phases, 'date', run_date=run_date, args=[case_id])

def init_scheduler():
    if not scheduler.running:
        scheduler.start()
