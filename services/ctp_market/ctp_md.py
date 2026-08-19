from __future__ import annotations

import traceback
from collections.abc import Callable
from threading import Lock
from typing import Any

from candles import valid_price
from config import FLOW_DIR, settings


def _ctp_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("gbk", errors="replace").strip("\x00").strip()
    return str(value).strip("\x00").strip()


def load_mdapi(profile: str):
    if profile == "simnow":
        from openctp_ctp import mdapi  # type: ignore

        return mdapi
    from openctp_tts import mdapi  # type: ignore

    return mdapi


class MarketClient:
    def __init__(self, on_event: Callable[[dict], None]) -> None:
        self.on_event = on_event
        self._lock = Lock()
        self.connected = False
        self.logged_in = False
        self.subscribed: list[str] = []
        self.last_error = ""
        self.tick_count = 0
        self.api = None
        self.spi = None
        self.mdapi = None
        self._req_id = 0

    def start(self) -> None:
        FLOW_DIR.mkdir(parents=True, exist_ok=True)
        flow = str(FLOW_DIR / f"{settings.profile}_md")
        self.mdapi = load_mdapi(settings.profile)
        self.api = self.mdapi.CThostFtdcMdApi.CreateFtdcMdApi(flow)
        self.spi = _make_spi(self.mdapi, self)
        self.api.RegisterSpi(self.spi)
        self.api.RegisterFront(settings.md_front)
        self._emit(
            {
                "type": "status",
                "connected": False,
                "logged_in": False,
                "profile": settings.profile,
                "front": settings.md_front,
                "symbols": settings.instruments,
                "message": f"Connecting {settings.profile} @ {settings.md_front}",
            }
        )
        self.api.Init()

    def stop(self) -> None:
        api = self.api
        self.api = None
        if api is not None:
            try:
                api.RegisterSpi(None)
            except Exception:
                pass
            try:
                api.Release()
            except Exception:
                pass

    def _next_req(self) -> int:
        self._req_id += 1
        return self._req_id

    def _emit(self, payload: dict) -> None:
        try:
            self.on_event(payload)
        except Exception:
            traceback.print_exc()

    def _set_status(self, **kwargs: Any) -> None:
        with self._lock:
            if "connected" in kwargs:
                self.connected = bool(kwargs["connected"])
            if "logged_in" in kwargs:
                self.logged_in = bool(kwargs["logged_in"])
            if "message" in kwargs:
                self.last_error = str(kwargs["message"])
            snapshot = {
                "type": "status",
                "connected": self.connected,
                "logged_in": self.logged_in,
                "profile": settings.profile,
                "front": settings.md_front,
                "symbols": list(self.subscribed or settings.instruments),
                "tick_count": self.tick_count,
                "message": kwargs.get("message", self.last_error),
            }
        self._emit(snapshot)

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "type": "status",
                "connected": self.connected,
                "logged_in": self.logged_in,
                "profile": settings.profile,
                "front": settings.md_front,
                "symbols": list(self.subscribed or settings.instruments),
                "tick_count": self.tick_count,
                "message": self.last_error,
            }

    def subscribe(self, instruments: list[str]) -> None:
        if not self.api or not instruments:
            return
        encoded = [s.encode("utf-8") for s in instruments]
        ret = self.api.SubscribeMarketData(encoded, len(encoded))
        if ret != 0:
            self._set_status(message=f"SubscribeMarketData failed: {ret}")


def _make_spi(mdapi, client: MarketClient):
    class MdSpi(mdapi.CThostFtdcMdSpi):
        def __init__(self) -> None:
            super().__init__()

        def OnFrontConnected(self) -> None:
            print("CTP MdApi connected")
            client._set_status(connected=True, message="Front connected, logging in")
            req = client.mdapi.CThostFtdcReqUserLoginField()
            req.BrokerID = settings.broker_id
            req.UserID = settings.user_id
            req.Password = settings.password
            ret = client.api.ReqUserLogin(req, client._next_req())
            if ret != 0:
                client._set_status(message=f"ReqUserLogin failed: {ret}")

        def OnFrontDisconnected(self, reason: int) -> None:
            print(f"CTP MdApi disconnected: {reason}")
            client.subscribed = []
            client._set_status(
                connected=False,
                logged_in=False,
                message=f"Disconnected ({reason})",
            )

        def OnRspUserLogin(self, pRspUserLogin, pRspInfo, nRequestID, bIsLast) -> None:
            error_id = getattr(pRspInfo, "ErrorID", 0) if pRspInfo else 0
            error_msg = _ctp_text(getattr(pRspInfo, "ErrorMsg", "")) if pRspInfo else ""
            if error_id:
                print(f"CTP login failed: {error_id} {error_msg}")
                client._set_status(logged_in=False, message=f"Login failed: {error_msg or error_id}")
                return
            trading_day = _ctp_text(getattr(pRspUserLogin, "TradingDay", ""))
            print(f"CTP login ok, trading day={trading_day}")
            client._set_status(logged_in=True, message=f"Logged in, trading day {trading_day}")
            client.subscribe(settings.instruments)

        def OnRspSubMarketData(self, pSpecificInstrument, pRspInfo, nRequestID, bIsLast) -> None:
            error_id = getattr(pRspInfo, "ErrorID", 0) if pRspInfo else 0
            error_msg = _ctp_text(getattr(pRspInfo, "ErrorMsg", "")) if pRspInfo else ""
            symbol = _ctp_text(getattr(pSpecificInstrument, "InstrumentID", "")) if pSpecificInstrument else ""
            if error_id:
                print(f"Subscribe failed {symbol}: {error_id} {error_msg}")
                client._set_status(message=f"Subscribe {symbol} failed: {error_msg or error_id}")
                return
            if symbol and symbol not in client.subscribed:
                client.subscribed.append(symbol)
            print(f"Subscribed: {symbol}")
            client._set_status(message=f"Subscribed {', '.join(client.subscribed)}")

        def OnRtnDepthMarketData(self, tick) -> None:
            if tick is None:
                return
            symbol = _ctp_text(getattr(tick, "InstrumentID", ""))
            last = float(getattr(tick, "LastPrice", 0) or 0)
            client.tick_count += 1
            if client.tick_count <= 5 or client.tick_count % 50 == 0:
                print(
                    f"tick #{client.tick_count} {symbol} last={last} "
                    f"time={_ctp_text(getattr(tick, 'UpdateTime', ''))} "
                    f"vol={getattr(tick, 'Volume', 0)}"
                )
            client._emit(
                {
                    "type": "tick",
                    "symbol": symbol,
                    "last": last if valid_price(last) else None,
                    "bid": _opt_price(getattr(tick, "BidPrice1", 0)),
                    "ask": _opt_price(getattr(tick, "AskPrice1", 0)),
                    "bid_volume": int(getattr(tick, "BidVolume1", 0) or 0),
                    "ask_volume": int(getattr(tick, "AskVolume1", 0) or 0),
                    "volume": int(getattr(tick, "Volume", 0) or 0),
                    "open_interest": float(getattr(tick, "OpenInterest", 0) or 0),
                    "pre_close": _opt_price(getattr(tick, "PreClosePrice", 0)),
                    "pre_settlement": _opt_price(getattr(tick, "PreSettlementPrice", 0)),
                    "action_day": _ctp_text(getattr(tick, "ActionDay", "")),
                    "trading_day": _ctp_text(getattr(tick, "TradingDay", "")),
                    "update_time": _ctp_text(getattr(tick, "UpdateTime", "")),
                    "update_millis": int(getattr(tick, "UpdateMillisec", 0) or 0),
                }
            )

    return MdSpi()


def _opt_price(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if valid_price(number) else None
