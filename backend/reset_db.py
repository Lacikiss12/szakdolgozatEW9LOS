"""Adatbázis újralétrehozása sémaváltás után. FIGYELEM: minden adat törlődik!

Használat (a backend/ mappában, aktivált venv-vel):
    python reset_db.py --yes
"""
import sys

from sqlalchemy import inspect, text

from app.core.database import Base, engine
from app.models import models  # noqa: F401  (a táblák regisztrálásához kell)

if "--yes" not in sys.argv:
    print("Ez TÖRÖL minden adatot (felhasználók, vizsgák, eredmények). Futtasd így: python reset_db.py --yes")
    sys.exit(1)

# A régi sémából maradt táblákat is eldobjuk (pl. ha átnevezés történt)
existing = inspect(engine).get_table_names()
with engine.begin() as conn:
    for table in existing:
        if engine.dialect.name == "postgresql":
            conn.execute(text(f'DROP TABLE IF EXISTS "{table}" CASCADE'))
Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)
print("Kész: a táblák újra létrehozva:", ", ".join(sorted(Base.metadata.tables)))
