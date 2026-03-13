# Fetch market data using choice API and store in PostgreSQL
# Adapted from fetch_huangjinetf.py
import requests
import psycopg2
from datetime import datetime, timedelta

DB_CONFIG = {
    'dbname': 'your_db',
    'user': 'your_user',
    'password': 'your_password',
    'host': 'localhost',
    'port': 5432
}

CHOICE_API_URL = 'https://your-choice-api-endpoint'

LAST_YEAR = (datetime.now() - timedelta(days=365)).strftime('%Y-%m-%d')
TODAY = datetime.now().strftime('%Y-%m-%d')


def fetch_market_data():
    params = {
        'start_date': LAST_YEAR,
        'end_date': TODAY,
        # Add other params as needed
    }
    response = requests.get(CHOICE_API_URL, params=params)
    response.raise_for_status()
    return response.json()


def store_to_postgres(data):
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()
    for item in data:
        cur.execute(
            "INSERT INTO market_data (date, ticker, field, value) VALUES (%s, %s, %s, %s) ON CONFLICT (date, ticker, field) DO UPDATE SET value = EXCLUDED.value",
            (item['date'], item['ticker'], item['field'], item['value'])
        )
    conn.commit()
    cur.close()
    conn.close()


def main():
    data = fetch_market_data()
    store_to_postgres(data)

if __name__ == "__main__":
    main()
