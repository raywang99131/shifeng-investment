from fastapi import APIRouter, Query, HTTPException
from typing import Optional, List
from pydantic import BaseModel
from services.akshareFetcher import fetch_batch_quotes, fetch_single_quote

router = APIRouter(prefix="/quotes", tags=["quotes"])

class QuoteResponse(BaseModel):
    code: str
    name: Optional[str] = None
    close: float
    pct_chg: float
    change: float
    pre_close: float
    open: float
    high: float
    low: float
    volume: float
    trade_date: str

class BatchQuotesResponse(BaseModel):
    success: bool
    trade_date: str
    quotes: List[dict]
    errors: List[dict]

@router.get("/batch")
async def get_batch_quotes(codes: str = Query(..., description="Comma-separated stock codes, e.g. 600519,000858")):
    code_list = [c.strip() for c in codes.split(",") if c.strip()]
    if not code_list:
        raise HTTPException(status_code=400, detail="No codes provided")
    if len(code_list) > 50:
        raise HTTPException(status_code=400, detail="Max 50 codes per request")

    result = fetch_batch_quotes(code_list)
    return result

@router.get("")
async def get_single_quote(code: str = Query(...)):
    quote = fetch_single_quote(code)
    if not quote:
        raise HTTPException(status_code=404, detail=f"No data found for {code}")
    return quote

@router.get("/health")
async def health_check():
    return {"status": "ok", "service": "quote-service"}