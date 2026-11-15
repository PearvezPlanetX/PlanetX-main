from backend.archive import search_observations

ra = 133.795129
dec = -7.245147

print("Searching SPHEREx Archive...")

observations = search_observations(
    ra,
    dec,
    radius = 0.05
)

print("\n--- COLUMN METADATA ---")

for column in observations.itercols():
    print(
        "Name:", column.name,
        "| Description:", column.info.description,
        "| Unit:", column.unit
    )

print("\n--- TABLE METADATA ---")
print(observations.meta)

print("\nSearch complete!")
print("Number of observations:", len(observations))

print("\nAvailabe columns:")
print(observations.colnames)

print("\nFirst result:")
for column in observations.colnames:
    print(column, "=", observations[column][0])

print("\nFirst observations:")
print(observations[:5]) 