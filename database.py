import os
import sqlite3
from datetime import datetime, timedelta
import requests
from dotenv import load_dotenv

load_dotenv()

DB_FILE = "/tmp/soud.db" # Na Vercelu je zapisovatelný pouze /tmp adresář

ODORIK_API_USER = os.getenv("ODORIK_API_USER", "")
ODORIK_API_PASSWORD = os.getenv("ODORIK_API_PASSWORD", "")
ODORIK_SMS_URL = "https://www.odorik.cz/api/v1/sms"

def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_number TEXT UNIQUE,
        department TEXT,
        applicant_name TEXT,
        applicant_phone TEXT,
        spouse_name TEXT,
        spouse_phone TEXT,
        other_parties TEXT,
        description TEXT,
        status TEXT,
        created_at TEXT,
        deadline_at TEXT,
        judge_name TEXT,
        verdict TEXT
    )
    """)
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS staff (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        department TEXT,
        name TEXT,
        role TEXT,
        personality TEXT
    )
    """)
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sms_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_number TEXT,
        recipient_phone TEXT,
        recipient_name TEXT,
        message TEXT,
        sent_at TEXT,
        status TEXT
    )
    """)
    
    cursor.execute("SELECT COUNT(*) FROM staff")
    if cursor.fetchone()[0] == 0:
        default_staff = [
            ("OSPOD", "Mgr. Alena Dvořáková", "Sociální kurátorka", "Empatická, ale přísná na ochranu zájmů dětí."),
            ("OSPOD", "Bc. Tomáš Černý", "Opatrovník a terénní pracovník", "Pečlivý vyšetřovatel rodinných poměrů."),
            ("Matrika", "JUDr. Květoslava Růžičková", "Matrikářka a soudkyně", "Důsledná znalkyně rodinného práva a předmanželských smluv."),
            ("Rozvody", "JUDr. Viktor Horák", "Předseda senátu pro rozvody", "Rozvážný, hledající smír, ale nekompromisní při rozvratu."),
            ("Arbitráž", "PhDr. Eva Kratochvílová", "Vztahová arbitra a psycholožka", "Specialistka na složité vztahy dvou, tří a více partnerů.")
        ]
        cursor.executemany("INSERT INTO staff (department, name, role, personality) VALUES (?, ?, ?, ?)", default_staff)
        
    conn.commit()
    conn.close()

def send_odorik_sms(phone: str, message: str, case_number: str, recipient_name: str):
    full_message = f"SOUD shazamské repub. : - {message}"
    
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO sms_logs (case_number, recipient_phone, recipient_name, message, sent_at, status) VALUES (?, ?, ?, ?, ?, ?)",
        (case_number, phone, recipient_name, full_message, datetime.now().isoformat(), "PENDING")
    )
    log_id = cursor.lastrowid
    conn.commit()
    conn.close()

    if ODORIK_API_USER and ODORIK_API_PASSWORD and phone:
        try:
            payload = {
                "user": ODORIK_API_USER,
                "password": ODORIK_API_PASSWORD,
                "sms": [
                    {"recipient": phone, "message": full_message}
                ]
            }
            response = requests.post(ODORIK_SMS_URL, json=payload, timeout=10)
            status = "SENT" if response.status_code == 200 else f"ERROR {response.status_code}"
        except Exception as e:
            status = f"EXCEPTION: {str(e)}"
    else:
        status = "SIMULATED (No Odorik credentials)"
        print(f"[SMS SIMULATION] To: {phone} ({recipient_name}) | Msg: {full_message}")

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("UPDATE sms_logs SET status = ? WHERE id = ?", (status, log_id))
    conn.commit()
    conn.close()
