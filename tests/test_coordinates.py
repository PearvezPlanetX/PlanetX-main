from backend.coordinates import get_search_position

target = get_search_position(
    ra=133.795129,
    dec=-7.245147,
    radius=0.05
)
print(target)