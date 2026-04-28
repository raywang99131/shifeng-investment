from sqlalchemy import create_engine, Column, Integer, String, Float, Date, UniqueConstraint, Index
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import date

Base = declarative_base()

class DailyQuote(Base):
    __tablename__ = "daily_quotes"
    id = Column(Integer, primary_key=True)
    stock_code = Column(String(10), nullable=False)
    trade_date = Column(Date, nullable=False)
    open = Column(Float, nullable=True)
    high = Column(Float, nullable=True)
    low = Column(Float, nullable=True)
    close = Column(Float, nullable=True)
    pre_close = Column(Float, nullable=True)
    volume = Column(Float, nullable=True)
    pct_chg = Column(Float, nullable=True)
    change = Column(Float, nullable=True)

    __table_args__ = (
        UniqueConstraint("stock_code", "trade_date", name="uq_stock_date"),
        Index("idx_dq_stock", "stock_code"),
        Index("idx_dq_date", "trade_date"),
    )

def get_engine():
    engine = create_engine("sqlite:///quotes.db", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    return engine

def get_session():
    engine = get_engine()
    Session = sessionmaker(bind=engine)
    return Session()