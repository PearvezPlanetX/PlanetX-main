
from astropy.time import Time
import numpy as np

from backend.archive import search_observations

TARGETS = {
    "Barnards Star": (269.452075, 4.693365),
    "WISE 0855": (133.795129, -7.245147),
    "RW Aurigae": (76.956525, 30.401438),
    "R Draconis": (248.167612, 66.754979),
}

for name, (ra, dec) in TARGETS.items():

    print("\n" + "=" * 60)
    print("TARGET:", name)
    print("=" * 60)

    try:
        observations = search_observations(ra, dec, radius=0.05)

        bands = {}

        for row in observations:
            band = row["energy_bandpassname"]
            obs_id = row["obs_id"]
            mjd = row["t_min"]

            if (
                np.ma.is_masked(band)
                or np.ma.is_masked(obs_id)
                or np.ma.is_masked(mjd)
            ):
                continue

            band = str(band).strip()
            obs_id = str(obs_id).strip()
            mjd = float(mjd) # type: ignore

            bands.setdefault(band, {})[obs_id] = mjd

        for band, records in sorted(bands.items()):

            times = sorted(set(records.values()))

            dates = [
                Time(mjd, format="mjd").to_value("iso", subfmt="date")
                for mjd in times
            ]

            print("\nBand:", band)
            print("Unique observations:", len(records))
            print("Distinct observation times:", len(times))

            if dates:
                print("First date:", dates[0])
                print("Last date:", dates[-1])

                print("Sample dates:")
                for date in dates[:10]:
                    print(" ", date)

    except Exception as error:
        print("FAILED:", error)
