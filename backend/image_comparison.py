
import numpy as np
import matplotlib.pyplot as plt
import os

from reproject import reproject_interp


def align_observations(observations):
    """
    Align multiple images to the first observation's pixel grid.
    """

    if len(observations) < 2:
        raise ValueError("At least two observations are required.")

    reference = observations[0]

    aligned = []

    for observation in observations:

        image = observation["image"]
        wcs = observation["wcs"]

        aligned_image, footprint = reproject_interp(
            (image, wcs),
            reference["wcs"],
            shape_out=reference["image"].shape
        )

        aligned.append({
            "date": observation["date"],
            "mjd": observation["mjd"],
            "image": aligned_image,
            "footprint": footprint
        })

    return aligned


def compare_observations(observations):
    """
    Calculate differences between aligned observations.
    """

    aligned = align_observations(observations)

    reference = aligned[0]["image"]

    comparisons = []

    for observation in aligned[1:]:

        current = observation["image"]

        difference = current - reference

        comparisons.append({
            "reference_date": aligned[0]["date"],
            "comparison_date": observation["date"],
            "difference": difference
        })

    return comparisons


def save_comparison(comparison, output_path):
    """
    Save a difference image visualization.
    """

    difference = comparison["difference"]

    valid_pixels = difference[np.isfinite(difference)]

    if valid_pixels.size == 0:
        raise ValueError("No valid pixels for comparison.")

    limit = np.nanpercentile(
        np.abs(valid_pixels),
        99
    )

    if limit == 0:
        limit = 1

    os.makedirs(
        os.path.dirname(output_path) or ".",
        exist_ok=True
    )

    plt.figure(figsize=(9, 7))

    plt.imshow(
        difference,
        origin="lower",
        cmap="RdBu_r",
        vmin=-limit,
        vmax=limit
    )

    plt.colorbar(label="Brightness difference (MJy / sr)")

    plt.title(
        f"Image Difference\n"
        f"{comparison['comparison_date']} - "
        f"{comparison['reference_date']}"
    )

    plt.xlabel("Pixel X")
    plt.ylabel("Pixel Y")

    plt.savefig(
        output_path,
        dpi=150,
        bbox_inches="tight"
    )

    plt.close()

    print("Saved comparison:", output_path)
