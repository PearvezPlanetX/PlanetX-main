
import numpy as np
import matplotlib.pyplot as plt

from astropy.io import fits
from astropy.stats import sigma_clipped_stats
from scipy.ndimage import gaussian_filter, maximum_filter

# Load science image
with fits.open("data/sample_spherex.fits") as hdul:
    image = hdul["IMAGE"].data.astype(float) # type: ignore

# Extract target cutout
cutout = image[103:204, 331:432]

# Remove invalid pixels
valid = np.isfinite(cutout) & (cutout > -9000)

background_value = np.median(cutout[valid])
clean_image = np.where(valid, cutout, background_value)

# Smooth image to reduce pixel-level noise
smoothed = gaussian_filter(clean_image, sigma=1.0)

# Estimate background statistics
mean, median, std = sigma_clipped_stats(
    smoothed[valid], sigma=3.0
)

threshold = median + 5 * std

# Identify local brightness peaks
local_max = smoothed == maximum_filter(smoothed, size=7)

detections = local_max & valid & (smoothed > threshold)

# Ignore the outer 4 pixels
detections[:4, :] = False
detections[-4:, :] = False
detections[:, :4] = False
detections[:, -4:] = False

# Extract source coordinates
ys, xs = np.where(detections)

# Sort by brightness, highest first
brightness = smoothed[ys, xs]
order = np.argsort(brightness)[::-1]

print("Background median:", median)
print("Background standard deviation:", std)
print("Detection threshold:", threshold)
print("Candidate sources:", len(xs))

print("\nTOP 20 CANDIDATES")

for rank, index in enumerate(order[:20], 1):
    x = xs[index]
    y = ys[index]
    value = brightness[index]

    print(
        f"{rank}. X={x}, Y={y}, "
        f"Brightness={value:.3f} MJy/sr"
    )

# Visualize detections
plt.figure(figsize=(9, 8))
plt.imshow(smoothed, origin="lower", cmap="gray")
plt.scatter(xs, ys, facecolors="none", edgecolors="red", s=45)
plt.colorbar(label="MJy/sr")
plt.title("SPHEREx Candidate Source Detection")
plt.xlabel("Pixel X")
plt.ylabel("Pixel Y")

plt.savefig("data/detected_sources.png", dpi=150)
plt.show()

print("\nSaved visualization to data/detected_sources.png")
