"""3D implied volatility surface (strike × expiry)."""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib import cm
from scipy.interpolate import griddata

from iv_analysis.plot_utils import save_figure


def plot_iv_surface(df: pd.DataFrame, label: str, output_path: Path) -> Path | None:
    valid = df.dropna(subset=["iv", "strike", "days_to_expiry"]).copy()
    valid = valid[valid["days_to_expiry"] >= 0]
    if len(valid) < 10:
        return None

    x = valid["strike"].values
    y = valid["days_to_expiry"].values
    z = valid["iv"].values

    xi = np.linspace(x.min(), x.max(), 40)
    yi = np.linspace(y.min(), y.max(), 40)
    xi_grid, yi_grid = np.meshgrid(xi, yi)
    zi = griddata((x, y), z, (xi_grid, yi_grid), method="linear")

    fig = plt.figure(figsize=(11, 7))
    ax = fig.add_subplot(111, projection="3d")
    surf = ax.plot_surface(xi_grid, yi_grid, zi, cmap=cm.viridis, edgecolor="none", alpha=0.9)

    ax.scatter(x, y, z, c="white", s=12, alpha=0.6, depthshade=False)
    ax.set_xlabel("Strike")
    ax.set_ylabel("Days to Expiry")
    ax.set_zlabel("IV (%)")
    ax.set_title(f"{label} — IV Surface")
    fig.colorbar(surf, ax=ax, shrink=0.55, label="IV (%)")

    return save_figure(fig, output_path)
