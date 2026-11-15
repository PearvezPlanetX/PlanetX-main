
from astropy.io import fits
from astropy.wcs import WCS
from astropy.coordinates import SkyCoord
from astropy.nddata import Cutout2D
from astropy.time import Time
import astropy.units as u
import numpy as np
import os


def get_observation_time(hdul):
    """
    Extract the observation date from a FITS header.
    """

    headers = [
        hdul[0].header,
        hdul["IMAGE"].header
    ]

    date_keys = ["DATE-OBS", "DATE-BEG", "DATE-AVG"]
    mjd_keys = ["MJD-OBS", "MJD-BEG", "MJD-AVG"]

    for header in headers:

        for key in date_keys:
            if key in header:
                return Time(header[key])

        for key in mjd_keys:
            if key in header:
                return Time(float(header[key]), format="mjd")

    raise ValueError("No observation date found in FITS headers.")


def process_observation(file_path, ra, dec, fov=0.05):
    """
    Load one FITS image and extract a cutout around the target.
    """

    if not os.path.exists(file_path):
        raise FileNotFoundError(file_path)

    with fits.open(file_path) as hdul:

        science = hdul["IMAGE"].data.astype(float) # type: ignore
        header = hdul["IMAGE"].header # type: ignore

        wcs = WCS(header).celestial

        observation_time = get_observation_time(hdul)

        target = SkyCoord(
            ra=ra * u.deg,
            dec=dec * u.deg,
            frame="icrs"
        )

        # Convert sky coordinates into image pixels.
        x_raw, y_raw = wcs.world_to_pixel(target)

        x: float = float(x_raw) # type: ignore
        y: float = float(y_raw) # type: ignore

        height, width = science.shape

        # Check whether the target is inside the image.
        inside = (
            0 <= x < width
            and 0 <= y < height
        )

        if not inside:
            print(f"Target outside image: {file_path}")
            return None

        # Extract a cutout using angular coordinates.
        cutout = Cutout2D(
            science,
            position=target,
            size=(fov * u.deg, fov * u.deg),
            wcs=wcs,
            mode="partial",
            fill_value=np.nan
        )

        return {
            "file": file_path,
            "date": observation_time.isot,
            "mjd": float(observation_time.mjd), # type: ignore
            "image": cutout.data,
            "wcs": cutout.wcs
        }


def load_time_series(fits_paths, ra, dec, fov=0.05):
    """
    Process multiple FITS files and sort them chronologically.
    """

    observations = []

    for file_path in fits_paths:

        print(f"\nProcessing: {file_path}")

        try:
            result = process_observation(
                file_path,
                ra,
                dec,
                fov
            )

            if result is not None:
                observations.append(result)

        except Exception as error:
            print(f"Could not process {file_path}: {error}")

    # Sort observations from oldest to newest.
    observations.sort(key=lambda item: item["mjd"])

    print("\n--- TIME SERIES RESULTS ---")
    print("Valid observations:", len(observations))

    for observation in observations:
        print(
            "Date:", observation["date"],
            "| Shape:", observation["image"].shape
        )

    return observations
