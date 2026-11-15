
import io
import time
import logging
import requests
import numpy as np

from astropy.table import Table, vstack
from astropy.io.votable import parse
from backend.coordinates import validate_coordinates

# --------------------------------------------------
# CONFIGURATION
# --------------------------------------------------

SIA_URL = "https://irsa.ipac.caltech.edu/SIA"

COLLECTION_GROUPS = {
    "dr1": ["spherex_dr1"],
    "qr3": ["spherex_qr3"],
    "current": ["spherex_dr1", "spherex_qr3"],
}

MAX_RETRIES = 3
TIMEOUT = 120

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# --------------------------------------------------
# COLLECTION SELECTION
# --------------------------------------------------

def get_collections(release="current"):
    """Return archive collections for the requested release."""

    if release not in COLLECTION_GROUPS:
        raise ValueError(
            f"Unknown release '{release}'. "
            f"Available releases: {list(COLLECTION_GROUPS)}"
        )

    return COLLECTION_GROUPS[release]


# --------------------------------------------------
# QUERY ONE COLLECTION
# --------------------------------------------------

def query_collection(ra, dec, radius, collection):
    """Retrieve observations from one SPHEREx collection."""

    params = {
        "COLLECTION": collection,
        "POS": f"circle {ra} {dec} {radius}",
        "RESPONSEFORMAT": "VOTABLE",
    }

    for attempt in range(MAX_RETRIES):
        try:
            logger.info(
                "Searching %s (attempt %s/%s)",
                collection,
                attempt + 1,
                MAX_RETRIES,
            )

            response = requests.get(
                SIA_URL,
                params=params,
                timeout=TIMEOUT,
            )

            response.raise_for_status()

            votable = parse(io.BytesIO(response.content))
            observations = votable.get_first_table().to_table()

            if len(observations) == 0:
                logger.info("%s returned zero observations.", collection)
                return Table()

            # Ensure the collection column has a consistent string type.
            if "collection" in observations.colnames:
                observations.remove_column("collection")

            observations["collection"] = np.full(
                len(observations),
                collection,
                dtype="U64",
            )

            logger.info(
                "%s returned %s observations.",
                collection,
                len(observations),
            )

            return observations

        except requests.exceptions.RequestException as error:
            logger.warning("%s request failed: %s", collection, error)

        except Exception as error:
            logger.exception(
                "Could not parse response from %s: %s",
                collection,
                error,
            )
            return Table()

        if attempt < MAX_RETRIES - 1:
            wait_time = 5 * (attempt + 1)
            logger.info("Retrying in %s seconds...", wait_time)
            time.sleep(wait_time)

    logger.error("%s failed after all retries.", collection)
    return Table()


# --------------------------------------------------
# REMOVE DUPLICATES
# --------------------------------------------------

def remove_duplicates(observations):
    """Remove duplicate records using their observation URL or ID."""

    if len(observations) == 0:
        return observations

    if "access_url" in observations.colnames:
        key_column = "access_url"
    elif "obs_id" in observations.colnames:
        key_column = "obs_id"
    else:
        logger.warning("No unique observation identifier found.")
        return observations

    seen = set()
    keep = []

    for index, value in enumerate(observations[key_column]):
        key = str(value)

        if key in ("", "None", "--"):
            keep.append(index)
            continue

        if key not in seen:
            seen.add(key)
            keep.append(index)

    return observations[keep]


# --------------------------------------------------
# MAIN ARCHIVE SEARCH
# --------------------------------------------------

def search_observations(
    ra,
    dec,
    radius=0.05,
    release="current",
):
    """
    Search SPHEREx for observations around RA/Dec.

    Parameters
    ----------
    ra : float
        Right ascension in degrees.
    dec : float
        Declination in degrees.
    radius : float
        Search radius in degrees.
    release : str
        'dr1', 'qr3', or 'current'.

    Returns
    -------
    astropy.table.Table
        Combined observation metadata.
    """

    logger.info("--- SPHEREX ARCHIVE SEARCH ---")
    logger.info("RA: %s | Dec: %s | Radius: %s", ra, dec, radius)

    # Validate coordinates.
    position = validate_coordinates(ra, dec)

    if not np.isfinite(radius) or radius <= 0:
        raise ValueError("Search radius must be positive and finite.")

    assert position.ra is not None
    ra = position.ra.deg
    assert position.dec is not None
    dec = position.dec.deg

    collections = get_collections(release)

    logger.info("Collections: %s", collections)

    results = []
    failed_collections = []

    # Search each collection independently.
    for collection in collections:

        logger.info("Searching collection: %s", collection)

        observations = query_collection(
            ra,
            dec,
            radius,
            collection,
        )

        if len(observations) > 0:
            results.append(observations)
        else:
            failed_collections.append(collection)

    # No results.
    if not results:
        logger.warning("No observations found in any collection.")

        empty = Table()
        empty.meta["failed_collections"] = failed_collections # type: ignore
        return empty

    # Combine only nonempty tables.
    if len(results) == 1:
        combined = results[0].copy()
    else:
        # Avoid schema conflicts when combining archive tables.
        normalized = []

        for table in results:
            table = table.copy()

            if "collection" in table.colnames:
                table.remove_column("collection")

            normalized.append(table)

        combined = vstack(
            normalized,
            join_type="outer",
            metadata_conflicts="silent",
        )

        # Restore collection information by matching access URLs.
        collection_lookup = {}

        for table in results:
            for url in table["access_url"]:
                collection_lookup[str(url)] = str(table["collection"][0])

        if "access_url" in combined.colnames:
            combined["collection"] = [
                collection_lookup.get(str(url), "unknown")
                for url in combined["access_url"]
            ]

    logger.info("Rows before deduplication: %s", len(combined))

    # Remove duplicate observations.
    combined = remove_duplicates(combined)

    # Sort chronologically.
    if "t_min" in combined.colnames:
        try:
            combined.sort("t_min")
        except Exception as error:
            logger.warning("Could not sort timestamps: %s", error)

    # Save search status in table metadata.
    combined.meta["failed_collections"] = failed_collections
    combined.meta["release"] = release

    logger.info("--- FINAL RESULTS ---")
    logger.info("Unique observations: %s", len(combined))

    if failed_collections:
        logger.warning(
            "Some collections returned no results or failed: %s",
            failed_collections,
        )

    return combined
