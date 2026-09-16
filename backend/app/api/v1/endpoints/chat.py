"""AI Data Analyst chat endpoints."""
# NOTE: this module deliberately omits `from __future__ import annotations`.
# slowapi wraps the rate-limited handlers, and with string annotations FastAPI
# resolves them against slowapi's module globals — where `DbSession` and
# `CurrentUser` do not exist — and falls back to treating them as body fields.

from typing import Annotated

from fastapi import APIRouter, Query, Request, status
from sqlalchemy import select

from app.ai.analyst import DataAnalyst
from app.ai.providers import provider_status
from app.api.deps import CurrentUser, DbSession, ReadyDataset, load_dataset_frame
from app.core.errors import NotFoundError
from app.core.ratelimit import ASK_LIMIT, limiter
from app.models import Conversation, Message
from app.schemas.chat import (
    AskRequest,
    AskResponse,
    ConversationDetail,
    ConversationSummary,
    MessageResponse,
)
from app.schemas.common import MessageResponse as SimpleMessage

router = APIRouter(tags=["ai-analyst"])

_MAX_MESSAGES_PER_CONVERSATION = 200


@router.get("/ai/status")
def ai_status() -> dict:
    """Tells the UI whether a model is configured or rules are in use."""
    return provider_status()


@router.post("/datasets/{dataset_id}/ask", response_model=AskResponse)
@limiter.limit(ASK_LIMIT)
async def ask(
    request: Request,
    payload: AskRequest,
    dataset: ReadyDataset,
    user: CurrentUser,
    db: DbSession,
) -> AskResponse:
    conversation = _resolve_conversation(db, payload, user.id, dataset.id)

    db.add(
        Message(conversation_id=conversation.id, role="user", content=payload.question.strip())
    )
    db.flush()

    frame = load_dataset_frame(dataset)
    analyst = DataAnalyst()
    result = await analyst.answer(payload.question, frame, dataset.profile, dataset.analysis)

    assistant = Message(
        conversation_id=conversation.id,
        role="assistant",
        content=result.answer,
        payload={
            "intent": result.intent,
            "chart": result.chart,
            "plan": result.plan,
            "result": result.result,
            "follow_ups": result.follow_ups,
            "source": result.source,
            "notes": result.notes,
        },
    )
    db.add(assistant)

    if conversation.title == "Nova conversa":
        conversation.title = payload.question.strip()[:80]

    _trim_conversation(db, conversation.id)
    db.commit()
    db.refresh(assistant)

    return AskResponse(
        conversation_id=conversation.id,
        message=MessageResponse.model_validate(assistant),
        answer=result.answer,
        intent=result.intent,
        chart=result.chart,
        result=result.result,
        plan=result.plan,
        follow_ups=result.follow_ups,
        source=result.source,
    )


def _resolve_conversation(db, payload: AskRequest, user_id: str, dataset_id: str) -> Conversation:
    if payload.conversation_id:
        conversation = db.get(Conversation, payload.conversation_id)
        if conversation is None or conversation.user_id != user_id:
            raise NotFoundError("Conversa não encontrada.")
        return conversation
    conversation = Conversation(user_id=user_id, dataset_id=dataset_id)
    db.add(conversation)
    db.flush()
    return conversation


def _trim_conversation(db, conversation_id: str) -> None:
    """Drop the oldest messages once a conversation grows past the cap."""
    total = db.scalars(
        select(Message.id)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc())
        .offset(_MAX_MESSAGES_PER_CONVERSATION)
    ).all()
    for message_id in total:
        obsolete = db.get(Message, message_id)
        if obsolete is not None:
            db.delete(obsolete)


@router.get("/datasets/{dataset_id}/conversations", response_model=list[ConversationSummary])
def list_conversations(
    dataset: ReadyDataset,
    user: CurrentUser,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> list[ConversationSummary]:
    rows = db.scalars(
        select(Conversation)
        .where(Conversation.user_id == user.id, Conversation.dataset_id == dataset.id)
        .order_by(Conversation.updated_at.desc())
        .limit(limit)
    ).all()
    return [ConversationSummary.model_validate(r) for r in rows]


@router.get("/conversations/{conversation_id}", response_model=ConversationDetail)
def get_conversation(conversation_id: str, user: CurrentUser, db: DbSession) -> ConversationDetail:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.user_id != user.id:
        raise NotFoundError("Conversa não encontrada.")
    return ConversationDetail(
        id=conversation.id,
        dataset_id=conversation.dataset_id,
        title=conversation.title,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        messages=[MessageResponse.model_validate(m) for m in conversation.messages],
    )


@router.delete("/conversations/{conversation_id}", response_model=SimpleMessage)
def delete_conversation(conversation_id: str, user: CurrentUser, db: DbSession) -> SimpleMessage:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.user_id != user.id:
        raise NotFoundError("Conversa não encontrada.")
    db.delete(conversation)
    db.commit()
    return SimpleMessage(message="Conversa removida.")


@router.get("/datasets/{dataset_id}/suggested-questions")
def suggested_questions(dataset: ReadyDataset) -> dict:
    """Starter questions tailored to the detected domain and real columns."""
    analysis = dataset.analysis
    domain = analysis["domain"]
    questions: list[str] = list(domain.get("suggested_questions", []))

    metrics = analysis["columns"]["metrics"]
    dimensions = analysis["columns"]["dimensions"]
    temporal = analysis["columns"]["temporal"]

    from app.services import semantics as sem

    if metrics and dimensions:
        questions.append(
            f"Qual {sem.humanize(dimensions[0]).lower()} tem o maior "
            f"{sem.humanize(metrics[0]).lower()}?"
        )
    if metrics and temporal:
        questions.append(f"Qual a evolução de {sem.humanize(metrics[0]).lower()} ao longo do tempo?")
    if len(metrics) >= 2:
        questions.append(
            f"Existe correlação entre {sem.humanize(metrics[0]).lower()} e "
            f"{sem.humanize(metrics[1]).lower()}?"
        )
    questions.append("Quais valores parecem fora do padrão?")
    questions.append("Quais são os principais problemas encontrados nos dados?")

    seen: set[str] = set()
    unique = [q for q in questions if not (q.lower() in seen or seen.add(q.lower()))]
    return {"questions": unique[:8], "domain": domain["label"]}
