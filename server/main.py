"""Snap Quest web server: scan API, AI Game Master API, and the mobile web app.

    uvicorn server.main:app --reload            (local)
    SNAPQUEST_FAKE_AI=1 uvicorn server.main:app (local, no Claude key needed)
"""
import asyncio
import os
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import gm
from .scanner import ScanError, scan_image

ROOT = Path(__file__).resolve().parent.parent
MAX_UPLOAD = 15 * 1024 * 1024
AI_PER_HOUR = int(os.environ.get("SNAPQUEST_AI_PER_HOUR", "60"))        # per visitor (IP)
AI_PER_DAY = int(os.environ.get("SNAPQUEST_AI_PER_DAY", "1500"))        # whole server
SCANS_PER_10_MIN = int(os.environ.get("SNAPQUEST_SCANS_PER_10_MIN", "30"))

app = FastAPI(title="Snap Quest", docs_url=None, redoc_url=None)


# ---- simple in-memory rate limits (one server instance) -----------------------
_hits: dict[str, deque] = defaultdict(deque)


def _limit(key: str, max_hits: int, window_s: int):
    now = time.time()
    q = _hits[key]
    while q and q[0] <= now - window_s:
        q.popleft()
    if len(q) >= max_hits:
        wait = int(q[0] + window_s - now) + 1
        when = f"{wait // 60} min" if wait > 90 else f"{wait} s"
        raise HTTPException(429, f"Too many requests. Try again in {when}.")
    q.append(now)


def _ip(request: Request):
    # the hosting proxy appends the real client address last; earlier entries can be faked
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[-1].strip() if fwd else (request.client.host if request.client else "?")


def _ai_quota(request: Request):
    _limit("ai-day", AI_PER_DAY, 24 * 3600)
    _limit("ai:" + _ip(request), AI_PER_HOUR, 3600)


@app.middleware("http")
async def no_stale_app(request: Request, call_next):
    response = await call_next(request)
    if not request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.exception_handler(gm.GMError)
async def gm_error(_, exc: gm.GMError):
    return JSONResponse({"detail": str(exc)}, status_code=exc.status)


# ---- API -----------------------------------------------------------------------
@app.get("/api/health")
async def health():
    return {"ok": True, "ai": "offline-test" if gm.FAKE_AI else gm.MODEL}


@app.post("/api/scan")
async def scan(request: Request, photo: UploadFile = File(...)):
    _limit("scan:" + _ip(request), SCANS_PER_10_MIN, 600)
    data = await photo.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "Photo is too large (max 15 MB).")
    try:
        return await asyncio.to_thread(scan_image, data)
    except ScanError as e:
        raise HTTPException(400, str(e))


def _trim(c: gm.Campaign) -> gm.Campaign:
    """Cap sizes of everything the phone sends, so one request can't get huge."""
    c.premise = c.premise.strip()[:1000] or "A classic fantasy adventure."
    c.heroes = [gm.Hero(name=h.name.strip()[:30] or "Hero", cls=h.cls.strip()[:30] or "Adventurer")
                for h in c.heroes[:6]]
    c.board = c.board[:60]
    c.summary = c.summary[:2000]
    c.places = {k[:6]: v[:40] for k, v in list(c.places.items())[:50]}
    c.party_tile = c.party_tile[:6]
    c.quests = c.quests[-10:]
    for q in c.quests:
        q.title, q.hook, q.tile = q.title[:80], q.hook[:300], q.tile[:6]
    c.recent = c.recent[-12:]
    for e in c.recent:
        e.text, e.who = e.text[:2000], e.who[:30]
    return c


@app.post("/api/story/start")
async def story_start(request: Request, campaign: gm.Campaign):
    _ai_quota(request)
    out = await gm.start(_trim(campaign))
    return out.model_dump()


class TurnRequest(BaseModel):
    campaign: gm.Campaign
    action: gm.Action


@app.post("/api/story/turn")
async def story_turn(request: Request, body: TurnRequest):
    _ai_quota(request)
    body.action.text = body.action.text.strip()[:500]
    body.action.hero = body.action.hero[:30]
    if body.action.kind == "say" and not body.action.text:
        raise HTTPException(400, "Say what your hero does.")
    if body.action.roll is not None and not 1 <= body.action.roll <= 20:
        raise HTTPException(400, "A d20 roll is a number from 1 to 20.")
    out = await gm.turn(_trim(body.campaign), body.action)
    return out.model_dump()


# ---- files ---------------------------------------------------------------------
@app.get("/print-tiles.pdf")
async def tiles_pdf():
    return FileResponse(ROOT / "tiles" / "snap_quest_tiles_A4.pdf", media_type="application/pdf",
                        filename="snap_quest_tiles_A4.pdf")


app.mount("/", StaticFiles(directory=ROOT / "web", html=True), name="web")
