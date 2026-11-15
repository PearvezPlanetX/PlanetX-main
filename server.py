
from pathlib import Path
from io import BytesIO
from datetime import datetime, timezone
import base64
import json

import numpy as np
from flask import Flask, jsonify, request, send_from_directory
from astropy.io import fits
from astropy.wcs import WCS
from astropy.nddata import Cutout2D
from astropy.coordinates import SkyCoord
from astropy.time import Time
import astropy.units as u
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
CANDIDATES_FILE = DATA_DIR / "candidates.json"

app = Flask(__name__)

GRID_COLS = 8
GRID_ROWS = 4
_fits_metadata_cache = None


@app.after_request
def add_local_development_cors(response):
    origin = request.headers.get("Origin", "")
    is_local_origin = (
        origin.startswith("http://localhost:")
        or origin.startswith("http://127.0.0.1:")
    )

    if is_local_origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
        response.headers["Vary"] = "Origin"

    return response


def get_fits_files():
    """Find FITS files stored in the project's data directory."""
    patterns = ("*.fits", "*.fits.gz", "*.fit", "*.fts")
    files = []

    for pattern in patterns:
        files.extend(DATA_DIR.glob(pattern))

    return sorted(set(files))


def get_fits_metadata():
    global _fits_metadata_cache
    files = get_fits_files()
    cache_key = tuple((path.name, path.stat().st_mtime_ns) for path in files)

    if _fits_metadata_cache and _fits_metadata_cache["key"] == cache_key:
        return _fits_metadata_cache["items"]

    items = []
    for path in files:
        try:
            with fits.open(path, memmap=True) as hdul:
                hdu = hdul["IMAGE"] if "IMAGE" in hdul else hdul[0]
                if hdu.data is None:
                    continue
                wcs = WCS(hdu.header)  # type: ignore
                if not wcs.has_celestial:
                    continue
                items.append({
                    "path": path,
                    "wcs": wcs,
                    "shape": hdu.data.shape[-2:],  # type: ignore
                    "date": get_observation_date(hdul),
                })
        except Exception as error:
            print(f"Skipping {path.name}: {error}")

    _fits_metadata_cache = {"key": cache_key, "items": items}
    return items


def get_sector_definitions():
    sectors = []
    for row in range(GRID_ROWS):
        for column in range(GRID_COLS):
            index = row * GRID_COLS + column + 1
            sectors.append({
                "id": f"SEC-{index:02d}",
                "index": index,
                "ra": round((column + 0.5) * (360 / GRID_COLS), 1),
                "dec": round(67.5 - row * 45, 1),
            })
    return sectors


def find_observations(ra, dec, edge_margin=0):
    target = SkyCoord(ra=ra * u.deg, dec=dec * u.deg)
    matches = []

    for item in get_fits_metadata():
        try:
            x, y = item["wcs"].world_to_pixel(target)
            height, width = item["shape"]
            if (
                edge_margin <= x < width - edge_margin
                and edge_margin <= y < height - edge_margin
            ):  # type: ignore
                matches.append({
                    "file": item["path"].name,
                    "date": item["date"],
                    "pixel_x": round(float(x), 2),  # type: ignore
                    "pixel_y": round(float(y), 2),  # type: ignore
                })
        except Exception as error:
            print(f"Skipping {item['path'].name}: {error}")

    return matches


def get_observation_date(hdul):
    """Read an observation date from common SPHEREx FITS headers."""
    for hdu in hdul:
        for key in ("DATE-OBS", "DATE-BEG", "DATE-AVG"):
            value = hdu.header.get(key)
            if value:
                return str(value)

        for key in ("MJD-OBS", "MJD-BEG", "MJD-AVG"):
            value = hdu.header.get(key)
            if value is not None:
                return Time(float(value), format="mjd").isot

    return "Date not recorded in FITS header"


def make_image_data_url(data):
    """Convert a science-image array into a PNG data URL."""
    data = np.asarray(data, dtype=float)
    valid = np.isfinite(data)

    if not np.any(valid):
        raise ValueError("The FITS cutout contains no valid pixels.")

    low, high = np.nanpercentile(data[valid], [2, 99.5])

    if high <= low:
        high = low + 1

    normalized = np.clip((data - low) / (high - low), 0, 1)

    fig, ax = plt.subplots(figsize=(5, 5))
    ax.imshow(normalized, origin="lower", cmap="inferno")
    ax.set_axis_off()

    buffer = BytesIO()
    fig.savefig(
        buffer,
        format="png",
        bbox_inches="tight",
        pad_inches=0,
        dpi=140
    )
    plt.close(fig)

    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return "data:image/png;base64," + encoded


@app.get("/")
def home():
    response = send_from_directory(ROOT, "index.html")
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/app.js")
def javascript():
    response = send_from_directory(ROOT, "app.js")
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/styles.css")
def stylesheet():
    response = send_from_directory(ROOT, "styles.css")
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/data/<path:filename>")
def data_file(filename):
    return send_from_directory(DATA_DIR, filename)


@app.get("/api/health")
def health():
    files = get_fits_files()

    return jsonify({
        "status": "ok",
        "fits_files_found": len(files),
        "files": [file.name for file in files]
    })


@app.get("/api/sectors")
def sectors():
    """Return all survey sectors and whether local FITS data covers them."""
    coverage = {
        sector["id"]: {
            "has_real_data": False,
            "observations": {},
            "sample_ra": None,
            "sample_dec": None,
        }
        for sector in get_sector_definitions()
    }

    for item in get_fits_metadata():
        height, width = item["shape"]
        for x in np.linspace(64, width - 64, 5):
            for y in np.linspace(64, height - 64, 5):
                position = item["wcs"].pixel_to_world(float(x), float(y))
                ra = float(position.ra.deg)
                dec = float(position.dec.deg)
                column = min(int(ra // (360 / GRID_COLS)), GRID_COLS - 1)
                row = min(max(int((90 - dec) // (180 / GRID_ROWS)), 0), GRID_ROWS - 1)
                sector_id = f"SEC-{row * GRID_COLS + column + 1:02d}"
                matches = find_observations(ra, dec, edge_margin=64)

                if matches:
                    entry = coverage[sector_id]
                    entry["has_real_data"] = True
                    entry["sample_ra"] = ra
                    entry["sample_dec"] = dec
                    for match in matches:
                        entry["observations"][match["file"]] = match

    result = []
    for sector in get_sector_definitions():
        entry = coverage[sector["id"]]
        result.append({
            **sector,
            "has_real_data": entry["has_real_data"],
            "observations": list(entry["observations"].values()),
            "sample_ra": entry["sample_ra"],
            "sample_dec": entry["sample_dec"],
        })
    return jsonify({"sectors": result})


@app.get("/api/observations")
def observations():
    """List local FITS files whose WCS contains the requested coordinate."""
    try:
        ra = float(request.args["ra"])
        dec = float(request.args["dec"])

        if not 0 <= ra < 360 or not -90 <= dec <= 90:
            raise ValueError("RA or Dec is outside its valid range.")

    except (KeyError, ValueError):
        return jsonify({
            "error": "Provide valid ra and dec query parameters."
        }), 400

    matches = find_observations(ra, dec)

    return jsonify({
        "ra": ra,
        "dec": dec,
        "count": len(matches),
        "observations": matches
    })


@app.get("/api/cutout")
def cutout():
    """Return a real SPHEREx image cutout for the requested coordinates."""
    try:
        ra = float(request.args["ra"])
        dec = float(request.args["dec"])
        size = float(request.args.get("size", "0.05"))

        if not 0 <= ra < 360 or not -90 <= dec <= 90:
            raise ValueError("RA or Dec is outside its valid range.")

        if not 0 < size <= 2:
            raise ValueError("Cutout size must be greater than 0 and at most 2 degrees.")

    except (KeyError, ValueError):
        return jsonify({
            "error": "Provide valid ra, dec, and size parameters."
        }), 400

    target = SkyCoord(ra=ra * u.deg, dec=dec * u.deg)

    for path in get_fits_files():
        try:
            with fits.open(path, memmap=True) as hdul:
                hdu = hdul["IMAGE"] if "IMAGE" in hdul else hdul[0]

                if hdu.data is None or hdu.data.ndim != 2: # type: ignore
                    continue

                wcs = WCS(hdu.header) # type: ignore

                if not wcs.has_celestial:
                    continue

                x, y = wcs.world_to_pixel(target)
                height, width = hdu.data.shape # type: ignore

                if not (0 <= x < width and 0 <= y < height): # type: ignore
                    continue

                cutout_data = Cutout2D(
                    hdu.data, # type: ignore
                    target,
                    size=(size * u.deg, size * u.deg),
                    wcs=wcs,
                    mode="partial"
                )

                image_url = make_image_data_url(cutout_data.data)

                return jsonify({
                    "status": "real_data",
                    "file": path.name,
                    "date": get_observation_date(hdul),
                    "ra": ra,
                    "dec": dec,
                    "pixel_x": round(float(x), 2), # type: ignore
                    "pixel_y": round(float(y), 2), # type: ignore
                    "shape": list(cutout_data.data.shape),
                    "image": image_url
                })

        except Exception as error:
            print(f"Could not process {path.name}: {error}")

    return jsonify({
        "status": "no_coverage",
        "message": "No local FITS image currently covers these coordinates.",
        "ra": ra,
        "dec": dec
    }), 404


def read_candidates():
    if not CANDIDATES_FILE.exists():
        return []

    candidates = json.loads(CANDIDATES_FILE.read_text())
    if not isinstance(candidates, list):
        raise ValueError("Candidate archive must contain a JSON array.")

    return candidates


@app.get("/api/candidates")
def list_candidates():
    """Return candidates previously saved by the frontend."""
    try:
        return jsonify({"candidates": read_candidates()})
    except (OSError, json.JSONDecodeError, ValueError) as error:
        return jsonify({"error": str(error)}), 500


@app.post("/api/candidates")
def save_candidate():
    """Save a candidate submitted by the frontend."""
    candidate = request.get_json(silent=True)

    if not isinstance(candidate, dict):
        return jsonify({"error": "Expected a JSON candidate object."}), 400

    DATA_DIR.mkdir(exist_ok=True)

    try:
        candidates = read_candidates()
        candidates.append(candidate)
        CANDIDATES_FILE.write_text(json.dumps(candidates, indent=2))

        return jsonify({
            "status": "saved",
            "candidate": candidate,
            "total": len(candidates)
        }), 201

    except (OSError, json.JSONDecodeError, ValueError) as error:
        return jsonify({"error": str(error)}), 500


@app.delete("/api/candidates")
def clear_candidates():
    """Clear the candidate archive."""
    try:
        if CANDIDATES_FILE.exists():
            CANDIDATES_FILE.unlink()
        return jsonify({"status": "cleared"})
    except OSError as error:
        return jsonify({"error": str(error)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
