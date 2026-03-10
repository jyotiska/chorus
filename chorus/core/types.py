from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field


class Archetype(str, Enum):
    ANALYTICAL = "analytical"
    CREATIVE = "creative"
    LEADER = "leader"
    SUPPORT = "support"
    CONTRARIAN = "contrarian"


class ActionType(str, Enum):
    PROPOSE = "propose"
    QUESTION = "question"
    AGREE = "agree"
    DISAGREE = "disagree"
    VOTE = "vote"
    NONE = "none"


class Action(BaseModel):
    type: ActionType = ActionType.NONE
    content: Optional[str] = None


class AgentConfig(BaseModel):
    name: str
    archetype: Archetype
    traits: list[str]
    description: str
    model: Optional[str] = None


class SessionConfig(BaseModel):
    topic: str
    context: Optional[str] = None
    expectations: Optional[list[str]] = None
    max_turns: int = Field(default=10, ge=1)
    agents: list[str]
    provider: str = "anthropic"
    model: Optional[str] = None


class Message(BaseModel):
    agent_name: str
    content: str
    turn: int


class ParsedResponse(BaseModel):
    thinking: Optional[str] = None
    message: str
    targets: list[str] = Field(default_factory=list)
    action: Action = Field(default_factory=Action)
    parse_quality: str = "structured"
