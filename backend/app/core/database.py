from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from config import DATABASE_URL

# SQLite-hoz (gyors helyi teszt) kell a check_same_thread=False
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """Adatbázis-munkamenet függőség; a kérés végén lezárja a kapcsolatot."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def sync_missing_columns():
    """Hiányzó oszlopok hozzáadása a meglévő táblákhoz (adatvesztés nélkül).

    A create_all meglévő táblát nem módosít; ez a függvény a modellben szereplő,
    de az adatbázisból hiányzó oszlopokat ALTER TABLE ... ADD COLUMN-nal pótolja.
    """
    from sqlalchemy import UniqueConstraint, inspect, text

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue
            db_col_info = {c["name"]: c for c in inspector.get_columns(table.name)}
            db_cols = set(db_col_info)
            if engine.dialect.name == "postgresql":
                # Régi sémából maradt, a modellben már nem szereplő NOT NULL oszlopok
                # blokkolnák az INSERT-et – az adatot megtartjuk, csak a NOT NULL-t vesszük le.
                for name, info in db_col_info.items():
                    if name not in table.columns and not info["nullable"]:
                        conn.execute(text(f'ALTER TABLE "{table.name}" ALTER COLUMN "{name}" DROP NOT NULL'))
                        print(f"[sema] Elavult oszlop NOT NULL feloldva: {table.name}.{name}")
                # Hiányzó (névvel ellátott) UNIQUE megszorítások pótlása
                db_uniques = {u["name"] for u in inspector.get_unique_constraints(table.name)}
                for cons in table.constraints:
                    if isinstance(cons, UniqueConstraint) and cons.name and cons.name not in db_uniques:
                        cols = ", ".join(f'"{c.name}"' for c in cons.columns)
                        conn.execute(text(f'ALTER TABLE "{table.name}" ADD CONSTRAINT "{cons.name}" UNIQUE ({cols})'))
                        print(f"[sema] UNIQUE megszorítás hozzáadva: {table.name}.{cons.name}")
            for col in table.columns:
                if col.name in db_cols:
                    continue
                col_type = col.type.compile(dialect=engine.dialect)
                ddl = f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {col_type}'
                default = col.default.arg if col.default is not None and col.default.is_scalar else None
                if default is not None:
                    literal = repr(default) if isinstance(default, str) else str(default).upper() if isinstance(default, bool) else str(default)
                    ddl += f" DEFAULT {literal}"
                    if not col.nullable:
                        ddl += " NOT NULL"
                conn.execute(text(ddl))
                print(f"[sema] Új oszlop hozzáadva: {table.name}.{col.name}")
                # A meglévő kérdések sorrendjét az id alapján töltjük fel
                if table.name == "questions" and col.name == "position" and engine.dialect.name == "postgresql":
                    conn.execute(text(
                        'UPDATE questions q SET position = s.rn FROM ('
                        ' SELECT id, ROW_NUMBER() OVER (PARTITION BY exam_id ORDER BY id) AS rn FROM questions'
                        ') s WHERE q.id = s.id'
                    ))
