# backend/growth_curve/workshop/__init__.py
from backend.growth_curve.workshop.models import (
    ConsistencyWarning,
    WorkshopCheckResult,
    WorkshopAdjustRequest,
    WorkshopDiscussRequest,
    WorkshopDiscussResponse,
)

__all__ = [
    "ConsistencyWarning",
    "WorkshopCheckResult",
    "WorkshopAdjustRequest",
    "WorkshopDiscussRequest",
    "WorkshopDiscussResponse",
    "check_growth_consistency",
]


def __getattr__(name):
    """Lazy attribute access for names added in later tasks."""
    if name == "check_growth_consistency":
        from backend.growth_curve.workshop.consistency_checker import (
            check_growth_consistency,
        )
        return check_growth_consistency
    raise AttributeError(f"module 'backend.growth_curve.workshop' has no attribute {name!r}")