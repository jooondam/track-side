"""analytic curvature from parametric first/second derivatives.

kept as a pure function of derivative arrays, decoupled from the spline object, so it can
be unit-tested against hand-computed textbook derivatives independent of scipy fitting
behavior.
"""

from __future__ import annotations

import numpy as np


def curvature_from_derivatives(
    dx: np.ndarray, dy: np.ndarray, ddx: np.ndarray, ddy: np.ndarray
) -> np.ndarray:
    """signed curvature kappa = (x'y'' - y'x'') / (x'^2 + y'^2)^1.5.

    sign convention: positive kappa means the path curves toward its left-hand normal
    (tangent rotated +90 degrees CCW) -- e.g. a CCW-traversed circle has positive kappa
    everywhere, curving toward its own center. This must stay paired with the normal
    direction used in offline/geometry/boundaries.py; the two conventions are only
    correct together.
    """
    return (dx * ddy - dy * ddx) / (dx**2 + dy**2) ** 1.5
