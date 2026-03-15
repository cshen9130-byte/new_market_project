import pandas as pd, joblib, os, sys

csv_path = os.path.join(os.path.dirname(__file__), 'data', 'pca_scores_clustered.csv')
model_path = os.path.join(os.path.dirname(__file__), 'models', 'gmm.joblib')

print("=== CSV cluster centroids ===")
df = pd.read_csv(csv_path)
print("Columns:", df.columns.tolist())
print()
print("Cluster centroids (mean PC1/PC2):")
print(df.groupby('Cluster')[['PC1','PC2']].mean().round(4))
print()
print("Cluster counts:")
print(df['Cluster'].value_counts().sort_index())
print()
print("Last 10 rows:")
print(df.tail(10).to_string())
print()

if os.path.exists(model_path):
    print("=== GMM model means ===")
    gmm = joblib.load(model_path)
    import numpy as np
    for i, m in enumerate(gmm.means_):
        sign = ('PC1+' if m[0]>0 else 'PC1-') + (' PC2+' if m[1]>0 else ' PC2-')
        print(f"  Cluster {i}: PC1={m[0]:.4f}, PC2={m[1]:.4f}  → {sign}")
else:
    print("GMM model not found at", model_path)
