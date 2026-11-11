from chorus.error_codes import ErrorCode


class ChorusError(Exception):
    def __init__(self, code: ErrorCode, message: str, status: int = 502) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
