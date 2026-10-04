"""Small geometry helpers for feed normalization (no external GIS dependency)."""
from typing import Any

# Rough US bounding boxes (lon_min, lat_min, lon_max, lat_max). Region-aware design
# (plan v3 §3): only 'US' is enabled in v1; CN gets its own boxes when it lands.
# Boxes are generous at the borders on purpose — a hazard just across the line can
# still threaten US users, and fusion/delivery filter by distance later anyway.
REGION_BOXES: dict[str, list[tuple[float, float, float, float]]] = {
    "US": [
        (-125.0, 24.0, -66.5, 49.5),   # contiguous states
        (-180.0, 51.0, -129.0, 71.5),  # Alaska (incl. western Aleutians below)
        (172.0, 51.0, 180.0, 53.5),    # Aleutians west of the antimeridian
        (-160.5, 18.5, -154.5, 22.5),  # Hawaii
        (-67.5, 17.5, -64.5, 18.7),    # Puerto Rico, USVI
        (144.5, 13.0, 146.2, 20.6),    # Guam, Northern Mariana Islands
        (-171.0, -14.6, -168.0, -11.0),  # American Samoa
    ],
}


def region_for(lat: float, lon: float) -> str | None:
    for region, boxes in REGION_BOXES.items():
        for lon_min, lat_min, lon_max, lat_max in boxes:
            if lon_min <= lon <= lon_max and lat_min <= lat <= lat_max:
                return region
    return None


def centroid(geometry: dict[str, Any] | None) -> tuple[float, float] | None:
    """(lat, lon) centre of a GeoJSON geometry — the mean of its vertices.

    Good enough to place an alert on a map and run proximity search; the full
    polygon stays in raw_payload for anything that needs the exact area.
    """
    if not geometry:
        return None
    if geometry.get("type") == "GeometryCollection":
        points = [c for g in geometry.get("geometries", []) if (c := centroid(g))]
        if not points:
            return None
        return sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)

    coords: list[tuple[float, float]] = []

    def walk(node: Any) -> None:
        if isinstance(node, (list, tuple)) and len(node) >= 2 and all(isinstance(v, (int, float)) for v in node[:2]):
            coords.append((float(node[0]), float(node[1])))
        elif isinstance(node, (list, tuple)):
            for child in node:
                walk(child)

    walk(geometry.get("coordinates"))
    if not coords:
        return None
    lon = sum(c[0] for c in coords) / len(coords)
    lat = sum(c[1] for c in coords) / len(coords)
    return lat, lon
