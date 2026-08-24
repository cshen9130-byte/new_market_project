from __future__ import annotations

import locale_fix

locale_fix.apply("C")

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
import time

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from candles import MinuteAggregator
from config import settings
from ctp_md import MarketClient
from watchers import WatchBook

LOGIN_WAIT_S = 12
FAILOVER_RETRY_S = 20
WATCHDOG_OK_S = 30
WATCH_SWEEP_S = 8

INDEX_PRODUCTS = ("IH", "IF", "IC", "IM")

STATIC_DIR = Path(__file__).resolve().parent / "static"
aggregator = MinuteAggregator()
latest_ticks: dict[str, dict] = {}
clients: set[WebSocket] = set()
event_queue: asyncio.Queue | None = None
loop: asyncio.AbstractEventLoop | None = None
md_client: MarketClient | None = None
watch_book = WatchBook()


def _index_symbols() -> list[str]:
    return [s for s in settings.instruments if s[:2].upper() in INDEX_PRODUCTS]


def _extra_symbols() -> list[str]:
    return watch_book.wanted()


def _live_symbols() -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for symbol in [*_index_symbols(), *_extra_symbols()]:
        key = str(symbol or "").upper()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def _tick_for(symbol: str) -> dict | None:
    return latest_ticks.get(symbol) or latest_ticks.get(symbol.upper())


def _pack_tick(tick: dict | None) -> dict | None:
    if not tick:
        return None
    return {
        "symbol": tick.get("symbol"),
        "last": tick.get("last"),
        "bid": tick.get("bid"),
        "ask": tick.get("ask"),
        "bid_volume": tick.get("bid_volume"),
        "ask_volume": tick.get("ask_volume"),
        "volume": tick.get("volume"),
        "open_interest": tick.get("open_interest"),
        "pre_open_interest": tick.get("pre_open_interest"),
        "pre_close": tick.get("pre_close"),
        "pre_settlement": tick.get("pre_settlement"),
        "average": tick.get("average"),
        "turnover": tick.get("turnover"),
        "open": tick.get("open"),
        "high": tick.get("high"),
        "low": tick.get("low"),
        "bids": tick.get("bids") or [],
        "asks": tick.get("asks") or [],
        "update_time": tick.get("update_time"),
        "update_millis": tick.get("update_millis"),
    }


def sync_subscriptions() -> None:
    client = md_client
    wanted = watch_book.subscribe_ids(settings.instruments)
    if client is None or not client.logged_in:
        return
    subscribed_u = {item.upper() for item in client.subscribed}
    base_u = {item.upper() for item in settings.instruments}
    wanted_u = {item.upper() for item in wanted}
    to_add = [item for item in wanted if item.upper() not in subscribed_u]
    to_drop = [
        item
        for item in client.subscribed
        if item.upper() not in base_u and item.upper() not in wanted_u
    ]
    if to_add:
        print(f"CTP watch subscribe {', '.join(to_add)}")
        client.subscribe(to_add)
    if to_drop:
        print(f"CTP watch unsubscribe {', '.join(to_drop)}")
        client.unsubscribe(to_drop)


def emit(payload: dict) -> None:
    if payload.get("type") == "tick":
        raw = str(payload.get("symbol") or "")
        symbol = watch_book.canonical(raw) if raw else ""
        if symbol:
            payload["symbol"] = symbol
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


def _restart_md(front: str) -> None:
    global md_client
    if md_client is None:
        md_client = MarketClient(emit)
    print(f"CTP reconnect {settings.md_front} -> {front}")
    md_client.stop()
    time.sleep(0.4)
    settings.use_front(front)
    md_client.start()


async def watchdog() -> None:
    """SimNow 仿真 30011 is dead outside CFFEX hours; fail over to 7x24 40011."""
    await asyncio.sleep(LOGIN_WAIT_S)
    tried_failover = False
    while True:
        client = md_client
        if client is not None and client.logged_in:
            tried_failover = False
            await asyncio.sleep(WATCHDOG_OK_S)
            continue
        alt = settings.fallback_md_front
        if not tried_failover and alt != settings.md_front:
            try:
                _restart_md(alt)
            except Exception as exc:
                import traceback

                traceback.print_exc()
                if client is not None:
                    client._set_status(message=f"CTP failover failed: {exc}")
            tried_failover = True
            await asyncio.sleep(FAILOVER_RETRY_S)
            continue
        await asyncio.sleep(WATCHDOG_OK_S)


async def sweep_watchers() -> None:
    while True:
        await asyncio.sleep(WATCH_SWEEP_S)
        changed = watch_book.expire()
        if changed or watch_book.watcher_count():
            sync_subscriptions()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global event_queue, loop, md_client
    loop = asyncio.get_running_loop()
    event_queue = asyncio.Queue()
    pump_task = asyncio.create_task(pump())
    md_client = MarketClient(emit)
    try:
        md_client.start()
    except Exception as exc:
        import traceback

        traceback.print_exc()
        md_client._set_status(message=f"CTP start failed: {exc}")
    watch_task = asyncio.create_task(watchdog())
    sweep_task = asyncio.create_task(sweep_watchers())
    try:
        yield
    finally:
        sweep_task.cancel()
        watch_task.cancel()
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
        "candle_counts": {s: len(aggregator.history(s)) for s in _live_symbols()},
        "index_symbols": _index_symbols(),
        "extra_symbols": _extra_symbols(),
        "watchers": watch_book.watcher_count(),
    }


@app.get("/api/bars")
async def bars(symbol: str | None = None) -> dict:
    if symbol:
        key = watch_book.canonical(symbol)
        return {"symbol": key, "candles": aggregator.history(key) or aggregator.history(symbol)}
    return {"candles": {s: aggregator.history(s) for s in _live_symbols()}}


@app.get("/api/live")
async def live() -> dict:
    status = md_client.snapshot() if md_client else {}
    extras = _extra_symbols()
    items: dict[str, dict] = {}
    for symbol in _live_symbols():
        items[symbol] = {
            "tick": _pack_tick(_tick_for(symbol)),
            "candle": aggregator.current(symbol),
        }
    return {
        **status,
        "index_symbols": _index_symbols(),
        "extra_symbols": extras,
        "symbols": _live_symbols(),
        "watchers": watch_book.watcher_count(),
        "items": items,
    }


class WatchRequest(BaseModel):
    watcher_id: str = Field(default="")
    symbols: list[str] = Field(default_factory=list)


class UnwatchRequest(BaseModel):
    watcher_id: str = Field(default="")


@app.post("/api/watch")
async def watch(payload: WatchRequest):
    watcher_id = payload.watcher_id.strip()
    if not watcher_id:
        return JSONResponse({"ok": False, "error": "missing watcher_id"}, status_code=400)
    symbols = watch_book.touch(watcher_id, payload.symbols)
    sync_subscriptions()
    return {
        "ok": True,
        "watchers": watch_book.watcher_count(),
        "extra_symbols": symbols,
    }


@app.post("/api/unwatch")
async def unwatch(payload: UnwatchRequest):
    watcher_id = payload.watcher_id.strip()
    if watcher_id:
        watch_book.drop(watcher_id)
        sync_subscriptions()
    return {"ok": True, "watchers": watch_book.watcher_count(), "extra_symbols": _extra_symbols()}


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
