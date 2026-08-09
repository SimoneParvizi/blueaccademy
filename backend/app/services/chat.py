from __future__ import annotations

import json
from collections.abc import AsyncIterator
from time import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.db.orm.chat_message import ChatMessage
from backend.app.services.ai import get_chat_provider_label, stream_chat_response

SYSTEM_PROMPT = '''You are BlueAccademy Assistant, an expert DevOps study helper embedded in a Kubernetes, Docker, and Pulumi learning platform.

Your role:
- Help engineers understand K8s, Docker, and Pulumi concepts clearly, including beginners who do not know the jargon yet
- Start with the direct answer in plain language before adding detail
- Prefer simple wording over textbook definitions
- If you use a technical term, explain it immediately in everyday language
- For flashcards and concept questions, first give a short memory-friendly answer, then a short explanation, then a tiny example only if it helps
- Give concise, practical answers with real command examples when commands are actually useful
- When showing commands, use proper fenced code blocks with the language (bash, yaml, typescript, python)
- Never output a bare language line such as "bash" or "yaml" without triple backticks
- Diagnose errors when the user pastes error messages or log output
- Provide hints without giving full answers when asked mid-exercise
- Reference official docs when appropriate

Tone:
- Clear, calm, concrete
- Never talk down to the user, but do not assume prior knowledge
- Avoid abstract phrases like "an abstraction that defines a logical set..." unless you immediately rewrite them in simpler words

Format:
- Use markdown
- Keep answers focused
- Adapt format to the question type:
  - First-time concept explanation: use a clear structure (for example "Short answer", then "What it means", then optional "Example")
  - Follow-up question in the same thread: answer directly in 1-4 concise sentences unless the user asks for more structure
- If the user asks in plain words like "I don't get ...", "what does X do?", or "explain this command", optionally start with a one-line "TL;DR:" when it adds clarity
- Do not repeat the same full template on every turn
- Do not repeat command blocks from earlier messages unless the user asks for commands or they are needed for the new question
- Prefer 3-6 short sentences or a few bullets over long paragraphs

Example style:
User: "What's a Service in Kubernetes?"
Assistant: "Short answer: A Service gives your app a stable way to reach a pod or group of pods.
What it means: Pods can restart and get new IP addresses. A Service gives them one stable name and IP, then forwards traffic to the right pods for you.
Example: Your frontend can call `my-api-service` instead of trying to track changing pod IPs."'''


def list_chat_history(db: Session, session_id: str) -> list[ChatMessage]:
    return list(
        db.scalars(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.id.asc())
        ).all()
    )


def add_chat_message(db: Session, session_id: str, role: str, content: str) -> ChatMessage:
    message = ChatMessage(
        session_id=session_id,
        role=role,
        content=content,
        created_at=round(time() * 1000),
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    return message


def clear_chat_history(db: Session, session_id: str) -> None:
    for message in list_chat_history(db, session_id):
        db.delete(message)
    db.commit()


async def stream_chat_events(
    db: Session,
    *,
    session_id: str,
    user_message: str,
    context: str | None,
) -> AsyncIterator[str]:
    history = list_chat_history(db, session_id)
    messages = [{"role": msg.role, "content": msg.content} for msg in history]
    contextual_message = f"[Context: {context}]\n\n{user_message}" if context else user_message
    messages.append({"role": "user", "content": contextual_message})

    add_chat_message(db, session_id, "user", user_message)

    full_response = ""
    try:
        async for text in stream_chat_response(system_prompt=SYSTEM_PROMPT, messages=messages):
            full_response += text
            yield f"data: {json.dumps({'text': text})}\n\n"

        add_chat_message(db, session_id, "assistant", full_response)
        yield f"data: {json.dumps({'done': True})}\n\n"
    except Exception as exc:
        print(f"AI chat error ({get_chat_provider_label()}): {exc}")
        yield f"data: {json.dumps({'error': str(exc) or 'AI error'})}\n\n"
