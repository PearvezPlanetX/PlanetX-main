
from backend.archive import search_observations

RA = 133.795129
DEC = -7.245147
RADIUS = 0.05

print("\n--- MULTI-RELEASE TEST ---")

observations = search_observations(
    RA,
    DEC,
    radius=RADIUS,
    release="current",
)

if len(observations) == 0:
    print("\nNo observations returned.")
    print("Possible reasons:")
    print("- SPHEREx archive temporarily unavailable (HTTP 502).")
    print("- No matching observations in the queried collections.")
    print("- Network or proxy issue.")

    assert observations.meta is not None
    print(
        "\nFailed collections:",
        observations.meta.get("failed_collections", [])
    )

else:
    print("\n--- RELEASE COUNTS ---")

    if "collection" in observations.colnames:
        for collection in set(observations["collection"]): # type: ignore
            count = sum(observations["collection"] == collection)
            print(f"{collection}: {count} observations")

    print("\n--- DETECTOR COUNTS ---")

    if "obs_id" in observations.colnames:
        for detector in ["D1", "D2", "D3", "D4", "D5", "D6"]:
            count = sum(
                detector in str(obs_id)
                for obs_id in observations["obs_id"]
            )
            print(f"{detector}: {count}")

    print("\n--- DATE RANGE ---")

    if "t_min" in observations.colnames:
        print("First observation:", observations["t_min"][0])
        print("Last observation:", observations["t_min"][-1])

    print("\n--- TEST COMPLETE ---")
