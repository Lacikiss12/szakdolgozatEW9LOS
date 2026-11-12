# Intelligens Online Vizsgáztató Rendszer

Miskolci Egyetem – egyetemi projekt / prototípus.

| Réteg | Technológia |
|---|---|
| Frontend | Next.js 14, Tailwind CSS, socket.io-client |
| Backend | FastAPI, SQLAlchemy, JWT, Pydantic, python-socketio |
| Adatbázis | PostgreSQL 15 (Docker) |
| Kódfuttatás | Docker sandbox (`python:3.11-slim`, hálózat nélkül, 128 MB RAM, csak olvasható FS, `nobody` felhasználó, 5 mp/teszt, 64 KB kimenet) |

## Funkciók

- **Feladattípusok:** programozási (tesztesetekkel), feleletválasztós (egy / több jó válasz), igaz-hamis,
  rövid szöveges válasz, kifejtős (esszé).
- **Automatikus pontozás:** a választós és rövid válaszos feladatokat azonnal; a több jó válaszosnál
  (jó − rossz jelölés) / összes jó arányban; a rövid válasznál kis/nagybetű és szóköz független, számoknál `3,14 = 3.14`.
- **Kódfeladat:** nyilvános példatesztek (a hallgató látja) + rejtett tesztek (csak sikeres/hibás jelzés);
  próbafuttatás saját bemenettel; az összes teszt egy konténerben fut.
- **Vizsgafolyamat:** kezdés → visszaszámláló → automatikus mentés → végleges beadás (lejáratkor automatikusan).
  Kitöltési idő = min(kezdés + időtartam, vizsga határideje). Vizsgánként egy kitöltés.
- **Oktatói felület:** feladatszerkesztő (típusonkénti űrlap), élő proctoring monitor, eredmények,
  kézi pontozás + szöveges visszajelzés, CSV export (Excel-kompatibilis).
- **Biztonság:** oktatói regisztráció csak meghívókóddal; a megoldókulcs soha nem jut el a hallgatóhoz;
  a Socket.io JWT-vel hitelesít; vizsgát / feladatot csak a létrehozó oktató kezelhet.

## Előfeltételek

- Docker Desktop (fusson!)
- Python 3.10+
- Node.js 18+

## Indítás (3 terminál)

**1. Adatbázis**
```bash
docker compose up -d
docker pull python:3.11-slim   # a sandbox image (egyszer kell)
```

**2. Backend** (`backend/` mappában)
```bash
python -m venv venv
venv\Scripts\activate            # Linux/macOS: source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
API dokumentáció (Swagger): http://localhost:8000/docs

> **Sémaváltás után** (pl. frissítéskor a régi verzióról) az adatbázist újra kell létrehozni –
> **minden adat törlődik**: `python reset_db.py --yes` (a backend/ mappában, aktivált venv-vel).

**3. Frontend** (`frontend/` mappában)
```bash
npm install
npm run dev
```
Megnyitás: http://localhost:3000

## Kipróbálás

1. Regisztrálj **oktatóként**: pipáld be az „Oktatóként regisztrálok” mezőt, meghívókód: `oktato123`
   (a `TEACHER_INVITE_CODE` változóval módosítható). Belépés után → *Oktatói felület*.
2. Hozz létre egy vizsgát, majd a *Feladatok* fülön adj hozzá feladatokat, pl.:
   - feleletválasztós: „Melyik a főváros?” – Pécs / **Budapest** / Győr
   - rövid válasz: „Mennyi a π két tizedesre?” – elfogadott: `3.14`
   - programozási: bemenet `2 3` → `5` (nyilvános), `10 -4` → `6` (rejtett)
   - kifejtős: „Mutasd be a REST API fogalmát!”
3. Egy másik böngészőben (vagy inkognitó ablakban) regisztrálj **hallgatóként**, és indítsd el a vizsgát.
4. Példa megoldás a programozási feladatra:
   ```python
   a, b = map(int, input().split())
   print(a + b)
   ```
5. Ha a hallgató ablakot / lapot vált, az oktató *Élő monitor* fülén azonnal megjelenik a figyelmeztetés.
6. Beadás után az oktató az *Eredmények* fülön pontozza a kifejtős választ; a hallgató a műszerfalon látja az eredményt.

## Beállítások (környezeti változók, opcionális)

| Változó | Alapérték |
|---|---|
| `DATABASE_URL` | `postgresql://postgres:password@localhost:5432/exam_system_db` |
| `SECRET_KEY` | fejlesztői kulcs – élesben cseréld le! |
| `TEACHER_INVITE_CODE` | `oktato123` (üresen hagyva nem lehet oktatóként regisztrálni) |
| `SANDBOX_IMAGE` | `python:3.11-slim` |
| `SANDBOX_TIMEOUT_SECONDS` | `5` (tesztesetenként) |
| `SANDBOX_OUTPUT_LIMIT` | `65536` bájt / teszteset |
| `NEXT_PUBLIC_API_URL` (frontend) | `http://localhost:8000` |

Gyors teszt Postgres nélkül: `DATABASE_URL=sqlite:///./dev.db`.
