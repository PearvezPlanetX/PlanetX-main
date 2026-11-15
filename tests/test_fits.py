
from backend.archive import search_observations
from astropy.io import fits
from astropy.wcs import WCS
from astropy.coordinates import SkyCoord
import astropy.units as u
import numpy as np
import os

# -----------------------------------
# CONFIGURATION
# -----------------------------------

RA = 133.795129
DEC = -7.245147
RADIUS = 0.05

FILE_PATH = "data/sample_spherex.fits"

print("\n--- SPHEREX FITS PROCESSING TEST ---")

# -----------------------------------
# STEP 1: SEARCH SPHEREX ARCHIVE
# -----------------------------------

print("\nSearching SPHEREx archive...")

try:
    observations = search_observations(
        RA,
        DEC,
        radius=RADIUS,
        release="current"
    )

    print("\n--- ARCHIVE RESULTS ---")
    print("Available columns:", observations.colnames)
    print("Number of observations:", len(observations))

    if len(observations) > 0:
        print("\n--- FIRST OBSERVATION ---")
        print(observations[0])

    else:
        print("\nNo observations returned.")
        print("The archive may be temporarily unavailable.")

except Exception as error:
    print("\nArchive search failed:", error)
    observations = None

# -----------------------------------
# STEP 2: LOAD LOCAL FITS FILE
# -----------------------------------

print("\n--- LOCAL FITS PROCESSING ---")

if not os.path.exists(FILE_PATH):
    raise FileNotFoundError(
        f"Local FITS file not found: {FILE_PATH}"
    )

print("Loading:", FILE_PATH)

with fits.open(FILE_PATH) as hdul:

    print("\n--- HDU INFORMATION ---")
    hdul.info()

    # Load science image
    science = hdul["IMAGE"].data.astype(float) # type: ignore
    header = hdul["IMAGE"].header # type: ignore

    print("\n--- IMAGE INFORMATION ---")
    print("Image shape:", science.shape)
    print("Image units:", header.get("BUNIT", "Unknown"))

    # -----------------------------------
    # STEP 3: CREATE WCS COORDINATE SYSTEM
    # -----------------------------------

    wcs = WCS(header)

    target = SkyCoord(
        ra=RA * u.deg,
        dec=DEC * u.deg,
        frame="icrs"
    )

    # Convert sky coordinates into image pixels
    x_raw, y_raw = wcs.world_to_pixel(target)

    x: float = float(x_raw) # type: ignore
    y: float = float(y_raw) # type: ignore

    print("\n--- TARGET LOCATION ---")
    print("RA:", RA)
    print("Dec:", DEC)
    print("Pixel X:", x)
    print("Pixel Y:", y)

    # -----------------------------------
    # STEP 4: CHECK IMAGE COVERAGE
    # -----------------------------------

    height, width = science.shape

    inside = (
        0 <= x < width
        and 0 <= y < height
    )

    print("\n--- TARGET COVERAGE ---")
    print("Target inside image:", inside)

    if not inside:
        print("Target is outside this FITS image.")

    else:

        # -----------------------------------
        # STEP 5: EXTRACT TARGET CUTOUT
        # -----------------------------------

        center_x = int(round(x))
        center_y = int(round(y))

        half_size = 50

        x1 = max(0, center_x - half_size)
        x2 = min(width, center_x + half_size + 1)

        y1 = max(0, center_y - half_size)
        y2 = min(height, center_y + half_size + 1)

        cutout = science[y1:y2, x1:x2]

        print("\n--- TARGET CUTOUT ---")
        print("Cutout shape:", cutout.shape)
        print("Minimum:", np.nanmin(cutout))
        print("Maximum:", np.nanmax(cutout))
        print("Mean:", np.nanmean(cutout))

        # -----------------------------------
        # STEP 6: SAVE CUTOUT
        # -----------------------------------

        import matplotlib.pyplot as plt

        os.makedirs("data", exist_ok=True)

        plt.figure(figsize=(8, 8))

        plt.imshow(
            cutout,
            origin="lower",
            cmap="inferno"
        )

        plt.colorbar(label="MJy / sr")
        plt.title("SPHEREx Target Cutout")

        plt.savefig(
            "data/target_cutout.png",
            dpi=150,
            bbox_inches="tight"
        )

        plt.close()

        print("\nSaved image: data/target_cutout.png")

print("\n--- FITS PROCESSING COMPLETE ---")
