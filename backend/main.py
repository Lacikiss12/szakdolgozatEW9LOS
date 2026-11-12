import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import FRONTEND_ORIGINS
from app.core.database import engine, Base, sync_missing_columns
from app.models import models  # noqa: F401  (a táblák regisztrálásához kell)
from app.api import attempts, auth, exams, results
from app.services.socket_server import sio

# Táblák automatikus létrehozása induláskor (fejlesztési fázisban hasznos).
# A create_all meglévő táblát NEM módosít – sémaváltás után: python reset_db.py --yes
Base.metadata.create_all(bind=engine)
sync_missing_columns()  # meglévő táblákhoz hiányzó oszlopok pótlása

fastapi_app = FastAPI(
    title="Intelligens Online Vizsgáztató Rendszer API",
    version="1.0.0",
    description="Szakdolgozati prototípus backend FastAPI-vel, Docker sandbox-szal és Socket.io-val.",
)

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

fastapi_app.include_router(auth.router)
fastapi_app.include_router(exams.router)
fastapi_app.include_router(attempts.router)
fastapi_app.include_router(results.router)


@fastapi_app.get("/", tags=["Root"])
def read_root():
    return {"message": "Üdvözöl az Intelligens Online Vizsgáztató Rendszer API-ján!", "status": "online"}


# A Socket.io a /socket.io útvonalon, minden más a FastAPI-hoz megy.
# Indítás: uvicorn main:app --reload
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)
