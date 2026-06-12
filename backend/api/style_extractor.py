"""STYLE Extractor API — analyze writing style from reference text."""

from fastapi import APIRouter, HTTPException

from backend.style_engine.style_extractor import StyleExtractor

router = APIRouter(prefix="/api/style", tags=["style"])


@router.post("/extract")
async def extract_style(data: dict):
    """Analyze writing style features from reference text.

    Request: { "project_id": "proj_xxx", "reference_text": "..." }
    Response: ExtractedStyle as dict
    """
    project_id = data.get("project_id", "")
    reference_text = data.get("reference_text", "")

    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "VALIDATION_ERROR",
                "message": "project_id 不能为空",
                "detail": {},
            },
        )

    if not reference_text or not reference_text.strip():
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "VALIDATION_ERROR",
                "message": "reference_text 不能为空",
                "detail": {},
            },
        )

    try:
        extractor = StyleExtractor()
        style = extractor.extract(reference_text)
        extractor.save(project_id, style)

        return {
            "error": False,
            "code": "OK",
            "message": "风格提取完成",
            "detail": style.to_dict(),
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "error": True,
                "code": "EXTRACT_FAILED",
                "message": f"风格提取失败: {str(e)}",
                "detail": {},
            },
        )
