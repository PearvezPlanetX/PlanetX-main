
from backend.time_series import load_time_series
from backend.image_comparison import compare_observations
from backend.image_comparison import save_comparison

RA = 133.795129
DEC = -7.245147

fits_files = [
    "data/sample_spherex.fits"
]

observations = load_time_series(
    fits_files,
    RA,
    DEC,
    fov=0.05
)

print("\n--- IMAGE COMPARISON TEST ---")

if len(observations) < 2:

    print("Only one observation is available.")
    print("At least two actual observations are required.")

else:

    comparisons = compare_observations(observations)

    for comparison in comparisons:

        print("Reference:", comparison["reference_date"])
        print("Compared:", comparison["comparison_date"])

        save_comparison(
            comparison,
            "data/comparison.png"
        )

print("\n--- TEST COMPLETE ---")
