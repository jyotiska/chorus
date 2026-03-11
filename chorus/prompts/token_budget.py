from chorus.core.types import Message


def count_tokens(text: str) -> int:
    return len(text) // 4


def count_tokens_messages(messages: list[dict[str, str]]) -> int:
    return sum(count_tokens(m.get("content", "")) for m in messages)


def trim_conversation(
    messages: list[Message], budget: int
) -> list[Message]:
    """Keep the most recent messages that fit within the token budget."""
    result: list[Message] = []
    used = 0

    for msg in reversed(messages):
        tokens = count_tokens(msg.content)
        if used + tokens <= budget:
            result.insert(0, msg)
            used += tokens
        else:
            break

    return result


class TokenBudgetManager:
    def __init__(
        self,
        context_window: int = 8192,
        reserve_for_response: int = 1024,
    ) -> None:
        self._total = context_window - reserve_for_response

    def conversation_budget(self, system_tokens: int) -> int:
        remaining = self._total - system_tokens
        return max(0, int(remaining * 0.5))

    def fits(self, text: str, used: int) -> bool:
        return used + count_tokens(text) <= self._total
