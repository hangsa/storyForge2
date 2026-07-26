# backend/llm/errors.py
"""Custom exceptions raised by the LLM routing layer."""


class ModelNotFoundError(LookupError):
    """Raised when a model id is referenced but not present in any provider
    catalog. Carries the model id for the caller to surface in error messages
    and the usage log."""

    def __init__(self, model_id: str):
        super().__init__(f"model '{model_id}' is not defined in any provider")
        self.model_id = model_id
