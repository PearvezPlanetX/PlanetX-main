
import numpy as np
import matplotlib.pyplot as plt

from astropy.io import fits
from astropy.wcs import WCS
from astropy.coordinates import SkyCoord
import astropy.units as u


def inspect_fits(
    file_path: str,
    target_ra: float,
    target_dec: float
) -> None:
    """Inspect a SPHEREx image and locate a target coordinate."""

    with fits.open(file_path, memmap=True) as hdul:

        # 1. Extract image and calibration data
        image_hdu = hdul["IMAGE"]
        image = image_hdu.data # type: ignore
        variance = hdul["VARIANCE"].data # type: ignore
        flags = hdul["FLAGS"].data # type: ignore

        if image is None or variance is None or flags is None:
            raise ValueError("A required FITS extension has no data.")

        # 2. Calculate image statistics
        valid_pixels = np.isfinite(image)

        print("\n--- SCIENCE IMAGE ---")
        print("Shape:", image.shape)
        print("Minimum:", np.nanmin(image))
        print("Maximum:", np.nanmax(image))
        print("Mean:", np.nanmean(image))
        print("Median:", np.nanmedian(image))
        print("Valid pixels:", np.count_nonzero(valid_pixels))

        print("\n--- IMAGE UNITS ---")
        print("BUNIT:", image_hdu.header.get("BUNIT", "Not specified")) # type: ignore

        # 3. Inspect WCS
        wcs = WCS(image_hdu.header) # type: ignore

        print("\n--- TARGET COORDINATES ---")
        target = SkyCoord(
            ra=target_ra * u.deg,
            dec=target_dec * u.deg,
            frame="icrs"
        )

        # Convert sky coordinates into image pixel coordinates
        pixel_x, pixel_y = wcs.world_to_pixel(target)

        print("Target RA:", target_ra)
        print("Target Dec:", target_dec)
        print("Pixel X:", pixel_x)
        print("Pixel Y:", pixel_y)

        # 4. Check whether target is inside the image
        height, width = image.shape

        inside_image = (
            np.isfinite(pixel_x) # type: ignore
            and np.isfinite(pixel_y) # type: ignore
            and 0 <= pixel_x < width # type: ignore
            and 0 <= pixel_y < height # type: ignore
        )

        print("\n--- TARGET LOCATION CHECK ---")

        if inside_image:
            print("Target is INSIDE the image.")
        else:
            print("Target is OUTSIDE the image.")

        # 5. Display the science image
        print("\nCreating science image visualization...")

        finite_values = image[np.isfinite(image)]

        vmin, vmax = np.percentile(finite_values, [1, 99.5])

        fig, ax = plt.subplots(figsize=(10, 9))

        display = ax.imshow(
            image,
            origin="lower",
            cmap="gray",
            vmin=vmin,
            vmax=vmax
        )

        if inside_image:
            ax.scatter(
                pixel_x, # type: ignore
                pixel_y, # type: ignore
                color="red",
                marker="+",
                s=150,
                label="Target coordinate"
            )
            ax.legend()

        ax.set_title("SPHEREx Science Image")
        ax.set_xlabel("Pixel X")
        ax.set_ylabel("Pixel Y")

        plt.colorbar(display, ax=ax, label="Image intensity")
        plt.tight_layout()
        plt.savefig("data/science_image.png", dpi=150)
        plt.show()

        print("Image saved to data/science_image.png")


if __name__ == "__main__":
    inspect_fits(
        file_path="data/sample_spherex.fits",
        target_ra=133.795129,
        target_dec=-7.245147
    )
