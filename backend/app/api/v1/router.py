"""API v1 router assembly."""
from fastapi import APIRouter

from app.api.v1.endpoints import auth, chat, dashboards, datasets, explore, export

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(datasets.router)
api_router.include_router(dashboards.router)
api_router.include_router(explore.router)
api_router.include_router(chat.router)
api_router.include_router(export.router)
