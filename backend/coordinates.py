from astropy.coordinates import SkyCoord
import astropy.units as u

def validate_coordinates(ra,dec):
    if not 0<= ra < 360:
        raise ValueError("Ra must be between 0 and 360 degrees.")
    if not -90 <= dec <= 90:
        raise ValueError("Dec must be between -90 and 0 degrees.")
    return SkyCoord(
        ra = ra*u.deg,
        dec = dec*u.deg,
        frame = "icrs"
    )

def get_search_position(ra, dec, radius = 0.05):
    position = validate_coordinates(ra,dec)
    if radius <= 0:
        raise ValueError("Search radius must be Postive")
    assert position.dec is not None
    assert position.ra is not None
    return{
        "ra":position.ra.deg,
        "dec":position.dec.deg,
        "radius": radius
    }