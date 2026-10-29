from fastapi import FastAPI, Form, Request, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
import sqlite3
import random
from datetime import datetime, timedelta
from database import init_db, DB_FILE, send_odorik_sms
from ai_engine import generate_ai_analysis, generate_sms_content, get_judge_for_department
from scheduler_manager import init_scheduler, schedule_case_workflow

app = FastAPI(title="AI Soud Shazamské republiky")
templates = Jinja2Templates(directory="templates")

@app.on_event("startup")
def startup_event():
    init_db()
    init_scheduler()

@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT id, case_number, department, applicant_name, spouse_name, status, created_at, deadline_at, judge_name FROM cases ORDER BY id DESC")
    cases = cursor.fetchall()
    
    cursor.execute("SELECT department, name, role, personality FROM staff")
    staff = cursor.fetchall()
    
    cursor.execute("SELECT case_number, recipient_phone, recipient_name, message, sent_at, status FROM sms_logs ORDER BY id DESC LIMIT 20")
    sms_logs = cursor.fetchall()
    conn.close()
    
    return templates.TemplateResponse("index.html", {
        "request": request,
        "cases": cases,
        "staff": staff,
        "sms_logs": sms_logs
    })

@app.post("/create_case")
def create_case(
    department: str = Form(...),
    applicant_name: str = Form(...),
    applicant_phone: str = Form(...),
    spouse_name: str = Form(...),
    spouse_phone: str = Form(...),
    other_parties: str = Form(""),
    description: str = Form(...)
):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    # Generování spisové značky
    case_num = f"{random.randint(1, 9)}T {random.randint(10, 99)}/2026"
    judge = get_judge_for_department(department)
    
    created_at = datetime.now()
    # Zákonná lhůta např. 30 dní
    deadline_at = created_at + timedelta(days=30)
    
    cursor.execute("""
    INSERT INTO cases (case_number, department, applicant_name, applicant_phone, spouse_name, spouse_phone, other_parties, description, status, created_at, deadline_at, judge_name, verdict)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        case_num, department, applicant_name, applicant_phone, spouse_name, spouse_phone, other_parties, description,
        "Zahájeno (Probíhá šetření)", created_at.isoformat(), deadline_at.isoformat(), judge["name"], "Probíhá hloubkové zkoumání rodinných vztahů..."
    ))
    case_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    # Úvodní AI analýza a SMS
    case_data = {
        "case_number": case_num,
        "department": department,
        "applicant_name": applicant_name,
        "spouse_name": spouse_name,
        "other_parties": other_parties,
        "description": description
    }
    
    # Odeslání zahajovacích SMS
    if applicant_phone:
        send_odorik_sms(applicant_phone, generate_sms_content("applicant", case_data, "zahájení"), case_num, applicant_name)
    if spouse_phone:
        send_odorik_sms(spouse_phone, generate_sms_content("spouse", case_data, "zahájení"), case_num, spouse_name)
        
    # Naplánování automatického posunu (v demo režimu za 1 minutu, jinak 30 dní)
    schedule_case_workflow(case_id, duration_minutes=1)
    
    return RedirectResponse(url="/", status_code=303)

@app.get("/case/{case_id}", response_class=HTMLResponse)
def case_detail(request: Request, case_id: int):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT id, case_number, department, applicant_name, applicant_phone, spouse_name, spouse_phone, other_parties, description, status, created_at, deadline_at, judge_name, verdict FROM cases WHERE id = ?", (case_id,))
    case = cursor.fetchone()
    
    cursor.execute("SELECT recipient_phone, recipient_name, message, sent_at, status FROM sms_logs WHERE case_number = ?", (case[1],))
    logs = cursor.fetchall()
    conn.close()
    
    if not case:
        raise HTTPException(status_code=404, detail="Případ nenalezen")
        
    return templates.TemplateResponse("case_detail.html", {
        "request": request,
        "case": case,
        "logs": logs
    })
