
from astropy.coordinates import SkyCoord
import astropy.units as u

from backend.archive import search_observations

TARGETS = {
    "Barnards Star": ("17h57m48.498s", "+04d41m36.114s"),
    "Epsilon Indi B": ("22h04m10.595s", "-56d46m58.239s"),
    "WISE 0855": ("08h55m10.831s", "-07d14m42.53s"),
    "RW Aurigae": ("05h07m49.566s", "+30d24m05.177s"),
    "R Draconis": ("16h32m40.227s", "+66d45m17.926s"),
}

for name, (ra_text, dec_text) in TARGETS.items():

    print("\n" + "=" * 50)
    print("TESTING:", name)
    print("=" * 50)

    position = SkyCoord(
        ra=ra_text,
        dec=dec_text,
        frame="icrs"
    )

    assert position.ra is not None
    ra = position.ra.deg
    assert position.dec is not None
    dec = position.dec.deg

    print(f"RA: {ra:.6f}")
    print(f"Dec: {dec:.6f}")

    try:
        observations = search_observations(
            ra,
            dec,
            radius=0.05
        )

        print("Observations found:", len(observations))

        if len(observations) > 0:
            print(
                observations[
                    ["obs_id", "energy_bandpassname", "t_min", "t_max"]
                ][:5]
            )

    except Exception as error:
        print("Search failed:", error)

