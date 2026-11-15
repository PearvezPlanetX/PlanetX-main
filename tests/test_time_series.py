
from backend.time_series import load_time_series

RA = 133.795129
DEC = -7.245147

# Start with the FITS file you already downloaded.
fits_files = [
    "data/sample_spherex.fits"
]

observations = load_time_series(
    fits_files,
    RA,
    DEC,
    fov=0.05
)

print("\n--- FINAL TEST ---")

if len(observations) == 0:
    print("No valid observations found.")
else:
    print("Time-series processing successful!")

    for obs in observations:
        print("Date:", obs["date"])
        print("Image shape:", obs["image"].shape)
