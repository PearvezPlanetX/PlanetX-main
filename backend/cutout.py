
import numpy as np
import matplotlib.pyplot as plt

from astropy.io import fits
from astropy.wcs import WCS
from astropy.coordinates import SkyCoord
import astropy.units as u


def extract_target_cutout(
    file_path: str,
    ra: float,
    dec: float,
    size: int = 101
):
    """Extract a square image centered on a sky coordinate."""

    if size <= 0 or size % 2 == 0:
        raise ValueError("Cutout size must be a positive odd number.")

    with fits.open(file_path, memmap=True) as hdul:

        image_hdu = hdul["IMAGE"]
        image = image_hdu.data # type: ignore

        if image is None:
            raise ValueError("Science image contains no data.")

        wcs = WCS(image_hdu.header) # type: ignore

        target = SkyCoord(
            ra=ra * u.deg,
            dec=dec * u.deg,
            frame="icrs"
        )

        # Convert target coordinates into image pixels
        x, y = wcs.world_to_pixel(target)

        if not np.isfinite(x) or not np.isfinite(y): # type: ignore
            raise ValueError("Target coordinates could not be mapped.")

        center_x = int(round(float(x))) # type: ignore
        center_y = int(round(float(y))) # type: ignore

        half_size = size // 2

        # Calculate cutout boundaries
        x_min = center_x - half_size
        x_max = center_x + half_size + 1
        y_min = center_y - half_size
        y_max = center_y + half_size + 1

        height, width = image.shape

        # Check image boundaries
        if (
            x_min < 0 or y_min < 0
            or x_max > width or y_max > height
        ):
            raise ValueError(
                "Target is too close to the image edge for this cutout."
            )

        # Extract the target region
        cutout = image[y_min:y_max, x_min:x_max].copy()

        print("\n--- TARGET CUTOUT ---")
        print("Cutout shape:", cutout.shape)
        print("Target pixel X:", x)
        print("Target pixel Y:", y)
        print("Cutout center:", half_size, half_size)

        # Display the cutout
        valid_pixels = cutout[np.isfinite(cutout)]

        if valid_pixels.size == 0:
            raise ValueError("Cutout contains no valid pixels.")

        vmin, vmax = np.percentile(valid_pixels, [1, 99])

        fig, ax = plt.subplots(figsize=(7, 7))

        display = ax.imshow(
            cutout,
            origin="lower",
            cmap="gray",
            vmin=vmin,
            vmax=vmax
        )

        # Mark the exact target location within the cutout
        ax.scatter(
            x - x_min, # type: ignore
            y - y_min, # type: ignore
            color="red",
            marker="+",
            s=150,
            label="Target"
        )

        ax.set_title("SPHEREx Target Cutout")
        ax.set_xlabel("Cutout Pixel X")
        ax.set_ylabel("Cutout Pixel Y")
        ax.legend()

        plt.colorbar(display, ax=ax, label="MJy / sr")
        plt.tight_layout()
        plt.savefig("data/target_cutout.png", dpi=150)
        plt.show()

        print("Saved: data/target_cutout.png")

        return cutout


if __name__ == "__main__":
    extract_target_cutout(
        file_path="data/sample_spherex.fits",
        ra=133.795129,
        dec=-7.245147,
        size=101
    )
