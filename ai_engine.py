import openai
import os
from database import DB_FILE
import sqlite3

# Pokud máte OpenAI klíč v prostředí, použije se pro inteligentní generování vyjádření a verdiktů.
# Jinak systém použije propracované fallback šablony.
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

def get_judge_for_department(department: string):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT name, role, personality FROM staff WHERE department = ? LIMIT 1", (department,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return {"name": row[0], "role": row[1], "personality": row[2]}
    return {"name": "JUDr. Jan Spravedlivý", "role": "Soudce", "personality": "Nestranný"}

def generate_ai_analysis(case_data: dict, phase: string):
    department = case_data["department"]
    judge = get_judge_for_department(department)
    
    # Prompt pro AI (pokud je klíč k dispozici)
    if OPENAI_API_KEY:
        try:
            client = openai.OpenAI(api_key=OPENAI_API_KEY)
            prompt = f"""
            Jsi soudní AI systém Shazamské republiky a tvůj soudní úředník/soudce je {judge['name']} ({judge['role']}, povaha: {judge['personality']}).
            Oddělení: {department}
            Případ: {case_data['case_number']}
            Navrhovatel: {case_data['applicant_name']}
            Druhý účastník: {case_data['spouse_name']}
            Ostatní: {case_data['other_parties']}
            Popis žádosti: {case_data['description']}
            Aktuální fáze: {phase} (např. 'zahájení', 'průběh/šetření', 'konečný verdikt')
            
            Vytvoř věcnou, profesionální, přísnou a úřední zprávu z pohledu soudu, která detailně hodnotí vztahy v rodině a situaci.
            """
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "system", "content": "Jsi přísný a spravedlivý AI soud."}, {"role": "user", "content": prompt}],
                max_tokens=400
            )
            return response.choices[0].message.content
        except Exception as e:
            print(f"OpenAI error: {e}")

    # Fallback inteligentní generování podle oddělení a fáze
    if phase == "zahájení":
        return (
            f"Soudní senát vedený soudcem {judge['name']} ({judge['role']}) přijal podanou žádost pod sp. zn. {case_data['case_number']}. "
            f"Zahajuje se hloubkové zkoumání rodinných vztahů a poměrů účastníků ({case_data['applicant_name']} a {case_data['spouse_name']}). "
            f"Vzhledem k povaze věci v oddělení {department} běží zákonná lhůta pro řádné šetření a vyjádření účastníků."
        )
    elif phase == "šetření":
        return (
            f"Odbor OSPOD a vyšetřovací tým provedli analýzu vzájemných vazeb. Bylo zjištěno, že situace vyžaduje dodržení celé zákonné lhůty "
            f"k zajištění klidu a ochraně všech dotčených osob. Účastníci byli vyzváni k předložení dodatečných důkazů."
        )
    else: # verdikt
        return (
            f"Po uplynutí zákonné lhůty a zhodnocení všech důkazů rozhodl soudce {judge['name']} takto: "
            f"Žádost pod sp. zn. {case_data['case_number']} se v oddělení {department} shledává důvodnou. "
            f"Byla stanovena nová pravidla pro péči, vztahy či majetkové vypořádání mezi {case_data['applicant_name']} a {case_data['spouse_name']}. "
            f"Řízení je tímto pravomocně ukončeno."
        )

def generate_sms_content(recipient_type: string, case_data: dict, phase: string):
    # recipient_type: 'applicant', 'spouse', 'other'
    name = case_data['applicant_name'] if recipient_type == 'applicant' else case_data['spouse_name']
    if not name:
        name = "Účastník"
        
    if phase == "zahájení":
        if recipient_type == 'applicant':
            return f"Vážený/á {name}, Vaše žádost byla přijata pod sp. zn. {case_data['case_number']} u oddělení {case_data['department']}. Řízení řádně běží dle zákonné lhůty."
        else:
            return f"Vážený/á {name}, byla proti Vám / ve Vaší věci podána žádost u soudu sp. zn. {case_data['case_number']}. Máte zákonnou lhůtu k vyjádření."
    elif phase == "šetření":
        return f"Vážený/á {name}, k Vašemu případu sp. zn. {case_data['case_number']} probíhá sociální a vztahové šetření. Sledujte pokyny soudu."
    else:
        return f"Vážený/á {name}, ve věci sp. zn. {case_data['case_number']} byl vydán konečný soudní verdikt oddělením {case_data['department']}. Zkontrolujte podrobnosti v portálu soudu."
