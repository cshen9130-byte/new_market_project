# Nightly ETL: Load trained model and predict current market
# Adapted from predict_current_cluster.py
import pandas as pd
import joblib
import psycopg2
from datetime import datetime

DB_CONFIG = {
    'dbname': 'your_db',
    'user': 'your_user',
    'password': 'your_password',
    'host': 'localhost',
    'port': 5432
}

MODEL_DIR = 'economy/models'  # Adjust path if needed


def fetch_latest_data():
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()
    cur.execute("SELECT * FROM market_data WHERE date = (SELECT MAX(date) FROM market_data)")
    rows = cur.fetchall()
    cur.close()
    conn.close()
    # Convert to DataFrame
    df = pd.DataFrame(rows, columns=['date', 'ticker', 'field', 'value'])
    # Pivot to wide format
    wide_df = df.pivot_table(index='date', columns=['ticker', 'field'], values='value')
    return wide_df


def predict_current_market():
    scaler = joblib.load(f"{MODEL_DIR}/scaler.joblib")
    pca = joblib.load(f"{MODEL_DIR}/pca.joblib")
    gmm = joblib.load(f"{MODEL_DIR}/gmm.joblib")
    print("模型已加载 (scaler / pca / gmm)")

    df = fetch_latest_data()
    df.dropna(axis=1, inplace=True)
    new_data_scaled = scaler.transform(df.values)
    new_pc = pca.transform(new_data_scaled)
    new_pc_features = pd.DataFrame(new_pc[:, :2], columns=["PC1", "PC2"])
    current_cluster = gmm.predict(new_pc_features)

    # Store prediction result
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO market_prediction (date, PC1, PC2, cluster) VALUES (%s, %s, %s, %s) ON CONFLICT (date) DO UPDATE SET PC1 = EXCLUDED.PC1, PC2 = EXCLUDED.PC2, cluster = EXCLUDED.cluster",
        (df.index[0], new_pc[0, 0], new_pc[0, 1], int(current_cluster[0]))
    )
    conn.commit()
    cur.close()
    conn.close()


def main():
    predict_current_market()

if __name__ == "__main__":
    main()
