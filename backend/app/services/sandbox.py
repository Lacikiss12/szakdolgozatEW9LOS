"""
Beküldött Python kód futtatása izolált Docker konténerben.

Egy kiértékeléshez egyetlen konténer indul, ebben egy kis "runner" script
egymás után lefuttatja a hallgató kódját minden tesztbemenettel, és JSON-ként
adja vissza az eredményeket. Így 10 teszteset sem jelent 10 konténerindítást.

Védelem:
  - nincs hálózat, 128 MB RAM, fél CPU, max 64 folyamat
  - csak olvasható gyökér-fájlrendszer, /tmp: 16 MB-os tmpfs
  - a hallgató kódja `nobody` felhasználóként fut (nem tudja meghamisítani a runner kimenetét)
  - tesztesetenkénti időkorlát és kimeneti méretkorlát
A kódot és a bemeneteket környezeti változóban adjuk át (nincs volume mount),
így Windows + Docker Desktop alatt is stabil.
"""
import json
import secrets

import docker
from docker.errors import DockerException, ImageNotFound

from config import SANDBOX_IMAGE, SANDBOX_OUTPUT_LIMIT, SANDBOX_TIMEOUT_SECONDS

_client = None

# A konténerben (root-ként) futó vezérlő script.
_RUNNER = r'''
import json, os, signal, subprocess, sys, threading
LIMIT = int(os.environ["LIMIT"]); T = float(os.environ["T"])
with open("/tmp/main.py", "w", encoding="utf-8") as f:
    f.write(os.environ["CODE"])
os.chmod("/tmp/main.py", 0o644)
inputs = json.loads(os.environ["TESTS"])
env = {"PATH": os.environ.get("PATH", ""), "PYTHONDONTWRITEBYTECODE": "1",
       "PYTHONIOENCODING": "utf-8", "HOME": "/tmp"}

def drain(stream, buf):
    n = 0
    while True:
        chunk = stream.read(8192)
        if not chunk:
            break
        if n < LIMIT:
            buf.append(chunk[:LIMIT - n])
        n += len(chunk)
    if n > LIMIT:
        buf.append(b"\n...[a kimenet le lett v\xc3\xa1gva]")

def feed(stream, data):
    try:
        stream.write(data)
        stream.close()
    except (BrokenPipeError, OSError):
        pass

results = []
for inp in inputs:
    p = subprocess.Popen([sys.executable, "/tmp/main.py"], stdin=subprocess.PIPE,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, cwd="/tmp",
                         user=65534, group=65534, extra_groups=[], start_new_session=True)
    out, err = [], []
    threads = [threading.Thread(target=drain, args=(p.stdout, out)),
               threading.Thread(target=drain, args=(p.stderr, err)),
               threading.Thread(target=feed, args=(p.stdin, inp.encode("utf-8")))]
    for t in threads:
        t.start()
    timed_out = False
    try:
        code = p.wait(timeout=T)
    except subprocess.TimeoutExpired:
        timed_out = True
        code = -1
    try:
        os.killpg(p.pid, signal.SIGKILL)  # az esetleges gyerekfolyamatokat is
    except ProcessLookupError:
        pass
    p.wait()
    for t in threads:
        t.join(timeout=2)
    results.append({"exit_code": code, "timed_out": timed_out,
                    "output": b"".join(out).decode("utf-8", "replace"),
                    "error": b"".join(err).decode("utf-8", "replace") or None})
sys.stdout.write("\n" + os.environ["MARKER"] + json.dumps(results))
'''


def _get_client():
    """Lusta inicializálás: ha nem fut a Docker, a backend ettől még elindul."""
    global _client
    if _client is None:
        _client = docker.from_env()
    return _client


def run_tests(code: str, inputs: list[str], timeout_seconds: int = SANDBOX_TIMEOUT_SECONDS) -> dict:
    """Lefuttatja a kódot minden bemenettel.

    Visszatérés: {"error": str | None,   # rendszerhiba (pl. nem fut a Docker) – ilyenkor results üres
                  "results": [{"exit_code", "timed_out", "output", "error"}, ...]}
    """
    if not inputs:
        inputs = [""]
    try:
        client = _get_client()
    except DockerException as e:
        return {"error": f"A Docker nem érhető el (fut a Docker Desktop?): {e}", "results": []}

    # Futtatásonként véletlen eredményjelölő. A hallgató programja nem ismeri
    # (a gyerekfolyamat környezetébe nem kerül át), így nem tudja utánozni; a
    # szerver ráadásul az ELSŐ előfordulást keresi, mert a runner a jelölő előtt
    # semmit nem ír ki, a hallgató kimenete pedig csak a jelölő utáni JSON-ban lehet.
    marker = f"__RESULTS_{secrets.token_hex(16)}__"

    run_kwargs = dict(
        image=SANDBOX_IMAGE,
        command=["python", "-c", _RUNNER],
        environment={
            "MARKER": marker,
            "CODE": code,
            "TESTS": json.dumps(inputs),
            "LIMIT": str(SANDBOX_OUTPUT_LIMIT),
            "T": str(timeout_seconds),
            "PYTHONDONTWRITEBYTECODE": "1",
        },
        network_mode="none",
        mem_limit="128m",
        nano_cpus=500_000_000,
        pids_limit=64,
        read_only=True,
        tmpfs={"/tmp": "size=16m,mode=1777"},
        cap_drop=["ALL"],
        cap_add=["SETUID", "SETGID", "KILL"],
        security_opt=["no-new-privileges"],
        detach=True,
    )

    container = None
    try:
        try:
            container = client.containers.run(**run_kwargs)
        except ImageNotFound:
            client.images.pull(SANDBOX_IMAGE)
            container = client.containers.run(**run_kwargs)

        try:
            container.wait(timeout=timeout_seconds * len(inputs) + 15)
        except Exception:
            container.kill()
            return {"error": "Időtúllépés a teljes kiértékelés során.", "results": []}

        stdout = container.logs(stdout=True, stderr=False).decode("utf-8", errors="replace")
        pos = stdout.find(marker)
        if pos == -1:
            stderr = container.logs(stdout=False, stderr=True).decode("utf-8", errors="replace")
            return {"error": f"A kiértékelő nem adott eredményt (memória-túllépés?). {stderr[-500:]}",
                    "results": []}
        return {"error": None, "results": json.loads(stdout[pos + len(marker):])}
    except Exception as e:
        return {"error": f"Futtatási hiba: {e}", "results": []}
    finally:
        if container is not None:
            try:
                container.remove(force=True)
            except Exception:
                pass
