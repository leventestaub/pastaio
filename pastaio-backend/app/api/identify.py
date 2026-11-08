from fastapi import APIRouter, Depends, File, UploadFile

from app.clients.base import VisionClient
from app.clients.factory import get_vision_client
from app.schemas.identify import IdentifyResponse
from app.services.dev_log import (
    log_request_start,
    log_response_returned,
    log_image_input,
    log_error,
    new_request_id,
)

router = APIRouter(prefix="/identify", tags=["identify"])


@router.post("", response_model=IdentifyResponse)
async def identify(
    image: UploadFile = File(...),
    client: VisionClient = Depends(get_vision_client),
) -> IdentifyResponse:
    rid = new_request_id()
    log_request_start(rid, "POST /identify", f"file={image.filename}")
    image_bytes = await image.read()
    log_image_input(rid, len(image_bytes))

    try:
        response = await client.identify(image_bytes)
    except Exception as e:
        log_error(rid, "/identify", e)
        raise

    log_response_returned(rid, f"shape={response.shape}")
    return response