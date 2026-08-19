from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from candles import MinuteAggregator
from config import settings
from ctp_md import MarketClient

INDEX_PRODUCTS = ("IH", "IF", "IC", "IM")

STATIC_DIR = Path(__file__).resolve().parent / "static"
aggregator = MinuteAggregator()
latest_ticks: dict[str, dict] = {}
clients: set[WebSocket] = set()
event_queue: asyncio.Queue | None = None
loop: asyncio.AbstractEventLoop | None = None
md_client: MarketClient | None = None


def _index_symbols() -> list[str]:
    return [s for s in settings.instruments if s[:2].upper() in INDEX_PRODUCTS]


def emit(payload: dict) -> None:
    if payload.get("type") == "tick":
        symbol = str(payload.get("symbol") or "")
        if symbol:
            latest_ticks[symbol] = payload
        candle = aggregator.on_tick(
            payload["symbol"],
            payload.get("last") or 0,
            payload.get("volume") or 0,
            payload.get("action_day") or payload.get("trading_day") or "",
            payload.get("update_time") or "",
            payload.get("update_millis") or 0,
        )
        if candle is not None:
            payload = {
                "type": "tick",
                "tick": payload,
                "candle": candle.as_dict(),
            }
    if loop is None or event_queue is None:
        return
    loop.call_soon_threadsafe(event_queue.put_nowait, payload)


async def broadcast(payload: dict) -> None:
    dead: list[WebSocket] = []
    for ws in list(clients):
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


async def pump() -> None:
    assert event_queue is not None
    while True:
        payload = await event_queue.get()
        await broadcast(payload)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global event_queue, loop, md_client
    loop = asyncio.get_running_loop()
    event_queue = asyncio.Queue()
    pump_task = asyncio.create_task(pump())
    md_client = MarketClient(emit)
    md_client.start()
    try:
        yield
    finally:
        pump_task.cancel()
        if md_client is not None:
            md_client.stop()


app = FastAPI(title="CTP Live 1m Chart", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
if STATIC_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def index():
    html = STATIC_DIR / "index.html"
    if html.is_file():
        return FileResponse(html)
    return JSONResponse({"ok": True, "service": "ctp_market", "symbols": settings.instruments})


@app.get("/api/state")
async def state() -> dict:
    status = md_client.snapshot() if md_client else {}
    symbol = settings.default_symbol
    return {
        **status,
        "default_symbol": symbol,
        "candles": aggregator.history(symbol),
        "candle_counts": {s: len(aggregator.history(s)) for s in settings.instruments},
        "index_symbols": _index_symbols(),
    }


@app.get("/api/bars")
async def bars(symbol: str | None = None) -> dict:
    if symbol:
        return {"symbol": symbol, "candles": aggregator.history(symbol)}
    return {"candles": {s: aggregator.history(s) for s in _index_symbols()}}


@app.get("/api/live")
async def live() -> dict:
    status = md_client.snapshot() if md_client else {}
    items: dict[str, dict] = {}
    for symbol in _index_symbols():
        tick = latest_ticks.get(symbol)
        items[symbol] = {
            "tick": {
                "symbol": tick.get("symbol"),
                "last": tick.get("last"),
                "bid": tick.get("bid"),
                "ask": tick.get("ask"),
                "volume": tick.get("volume"),
                "open_interest": tick.get("open_interest"),
                "pre_close": tick.get("pre_close"),
                "pre_settlement": tick.get("pre_settlement"),
                "update_time": tick.get("update_time"),
                "update_millis": tick.get("update_millis"),
            }
            if tick
            else None,
            "candle": aggregator.current(symbol),
        }
    return {**status, "items": items}


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    clients.add(websocket)
    status = md_client.snapshot() if md_client else {"type": "status", "message": "starting"}
    await websocket.send_json(status)
    await websocket.send_json(
        {
            "type": "snapshot",
            "symbol": settings.default_symbol,
            "candles": aggregator.history(settings.default_symbol),
        }
    )
    try:
        while True:
            message = await websocket.receive_json()
            if message.get("type") == "snapshot":
                symbol = str(message.get("symbol") or settings.default_symbol)
                await websocket.send_json(
                    {
                        "type": "snapshot",
                        "symbol": symbol,
                        "candles": aggregator.history(symbol),
                    }
                )
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(websocket)


if __name__ == "__main__":
    print(f"Open http://{settings.host}:{settings.port}")
    print(f"Profile={settings.profile}  Front={settings.md_front}")
    print(f"Instruments={', '.join(settings.instruments)}")
    uvicorn.run(app, host=settings.host, port=settings.port, reload=False)
