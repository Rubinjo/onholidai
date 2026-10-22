import json
import re
from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Literal, Self, cast

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    StringConstraints,
    model_validator,
)
from pydantic.alias_generators import to_camel

UUID_PATTERN = (
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
)
DRAFT_TARGET_PATTERN = (
    r"^/(departureOrigin|departureOrigins|destinationOrder|availabilityWindows|duration|travellerParty|preferences|constraints|"
    r"destinations|itineraryDays|components)(/.*)?$"
)
PROTECTED_KEYS = [
    "supplierAmount",
    "supplierTotal",
    "supplierMinor",
    "platformMargin",
    "platformMarginTotal",
    "marginMinor",
    "bookingStatus",
    "authorization",
    "payment",
    "passport",
    "__proto__",
    "prototype",
    "constructor",
]


def nonblank(value: str) -> str:
    if not value.strip():
        raise ValueError("A nonblank string is required")
    return value


def protected_key(value: str) -> bool:
    normalized = re.sub(r"[^a-z0-9]", "", value.lower())
    return any(normalized == re.sub(r"[^a-z0-9]", "", key.lower()) for key in PROTECTED_KEYS)


def utc_datetime(value: str) -> str:
    datetime.fromisoformat(value)
    return value


type UUIDString = Annotated[
    str, StringConstraints(pattern=UUID_PATTERN), Field(json_schema_extra={"format": "uuid"})
]
type UTCDateTime = Annotated[
    str,
    StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$"),
    AfterValidator(utc_datetime),
    Field(json_schema_extra={"format": "date-time"}),
]
type Text120 = Annotated[
    str,
    StringConstraints(min_length=1, max_length=120),
    AfterValidator(nonblank),
    Field(json_schema_extra={"x-nonblank": True}),
]
type Text200 = Annotated[
    str,
    StringConstraints(min_length=1, max_length=200),
    AfterValidator(nonblank),
    Field(json_schema_extra={"x-nonblank": True}),
]
type Text500 = Annotated[
    str,
    StringConstraints(min_length=1, max_length=500),
    AfterValidator(nonblank),
    Field(json_schema_extra={"x-nonblank": True}),
]
type Text1000 = Annotated[
    str,
    StringConstraints(min_length=1, max_length=1000),
    AfterValidator(nonblank),
    Field(json_schema_extra={"x-nonblank": True}),
]
type Text4000 = Annotated[
    str,
    StringConstraints(min_length=1, max_length=4000),
    AfterValidator(nonblank),
    Field(json_schema_extra={"x-nonblank": True}),
]
type Text12000 = Annotated[
    str,
    StringConstraints(min_length=1, max_length=12000),
    AfterValidator(nonblank),
    Field(json_schema_extra={"x-nonblank": True}),
]
type PositiveInt = Annotated[int, Field(strict=True, ge=1, le=2147483647)]
type NonNegativeInt = Annotated[int, Field(strict=True, ge=0, le=2147483647)]


def field_value(value: object, path: str) -> object:
    current = value
    for part in path.split("."):
        if not isinstance(current, Mapping):
            return None
        current = cast(Mapping[str, object], current).get(part)
    return current


def matches(value: object, schema: Mapping[str, object]) -> bool:
    """Evaluate the small standard JSON Schema subset used for cross-field rules."""
    if "const" in schema and value != schema["const"]:
        return False
    if "enum" in schema and value not in cast(list[object], schema["enum"]):
        return False
    if "type" in schema:
        raw_type = schema["type"]
        types: list[object] = (
            cast(list[object], raw_type) if isinstance(raw_type, list) else [raw_type]
        )
        valid = {
            "null": value is None,
            "string": isinstance(value, str),
            "object": isinstance(value, Mapping),
            "array": isinstance(value, list),
        }
        if not any(valid.get(str(kind), False) for kind in types):
            return False
    if isinstance(value, Mapping):
        data = cast(Mapping[str, object], value)
        if any(key not in data for key in cast(list[str], schema.get("required", []))):
            return False
        for key, child in cast(
            Mapping[str, Mapping[str, object]], schema.get("properties", {})
        ).items():
            if key in data and not matches(data[key], child):
                return False
    if (
        "contains" in schema
        and isinstance(value, list)
        and not any(
            matches(item, cast(Mapping[str, object], schema["contains"]))
            for item in cast(list[object], value)
        )
    ):
        return False
    if schema.get("uniqueItems") and isinstance(value, list):
        items = cast(list[object], value)
        if len({json.dumps(item, sort_keys=True) for item in items}) != len(items):
            return False
    for clause in cast(list[Mapping[str, object]], schema.get("allOf", [])):
        if not matches(cast(object, value), clause):
            return False
    if "if" in schema:
        branch = (
            "then"
            if matches(cast(object, value), cast(Mapping[str, object], schema["if"]))
            else "else"
        )
        if branch in schema and not matches(
            cast(object, value), cast(Mapping[str, object], schema[branch])
        ):
            return False
    return True


def check_rules(value: object, rules: Mapping[str, object]) -> None:
    if not matches(value, rules):
        raise ValueError("Contract fields are inconsistent")
    for left, right in cast(list[list[str]], rules.get("x-equal-fields", [])):
        left_value = field_value(value, left)
        if left_value is not None and left_value != field_value(value, right):
            raise ValueError("Scoped request/version identity does not match")
    for left, right in cast(list[list[str]], rules.get("x-not-future-fields", [])):
        left_value = field_value(value, left)
        right_value = field_value(value, right)
        if left_value is not None and (
            not isinstance(left_value, int)
            or not isinstance(right_value, int)
            or left_value > right_value
        ):
            raise ValueError("Historical context cannot claim a future trip version")
    if (
        rules.get("x-protected-target")
        and isinstance(value, str)
        and any(protected_key(part) for part in value.split("/"))
    ):
        raise ValueError("Protected draft target")
    if "x-json-bound" in rules:
        bound = cast(Mapping[str, object], rules["x-json-bound"])
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        if len(encoded.encode("utf-8")) > int(cast(int, bound["bytes"])):
            raise ValueError("JSON context exceeds its byte budget")

        def visit(item: object, depth: int) -> None:
            if depth > int(cast(int, bound["depth"])):
                raise ValueError("JSON context nesting is too deep")
            if isinstance(item, Mapping):
                for key, child in cast(Mapping[str, object], item).items():
                    if protected_key(key) and not (
                        key == "bookingStatus"
                        and (child == "unbooked" or bound.get("allowBookingStatus"))
                    ):
                        raise ValueError("JSON contains protected fields")
                    visit(child, depth + 1)
            elif isinstance(item, list):
                for child in cast(list[object], item):
                    visit(child, depth + 1)

        visit(value, 0)
    if rules.get("x-nonblank") and isinstance(value, str):
        nonblank(value)


class ContractModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        alias_generator=to_camel,
        validate_by_name=False,
        hide_input_in_errors=True,
        allow_inf_nan=False,
    )

    @model_validator(mode="after")
    def validate_contract_rules(self) -> Self:
        data = self.model_dump(mode="json", by_alias=True)
        extra = type(self).model_config.get("json_schema_extra")
        if isinstance(extra, Mapping):
            check_rules(data, cast(Mapping[str, object], extra))
        for name, field in type(self).model_fields.items():
            field_extra = cast(object, field.json_schema_extra)
            if isinstance(field_extra, Mapping):
                check_rules(
                    data.get(field.alias or name),
                    cast(Mapping[str, object], field_extra),
                )
        return self


class DraftOperation(ContractModel):
    operation: Literal["add", "replace", "remove", "reorder"]
    target: Annotated[
        str,
        Field(
            pattern=DRAFT_TARGET_PATTERN,
            max_length=500,
            json_schema_extra={"x-protected-target": True},
        ),
    ]
    value: JsonValue = Field(json_schema_extra={"x-json-bound": {"bytes": 65536, "depth": 16}})


def status_result_rules() -> list[dict[str, JsonValue]]:
    return [
        {
            "if": {"properties": {"status": {"const": status}}},
            "then": {
                "properties": {
                    "result": (
                        {"type": "null"}
                        if kind is None
                        else {"type": "object", "properties": {"kind": {"const": kind}}}
                    )
                }
            },
        }
        for status, kind in [
            ("awaiting_clarification", "clarification"),
            ("proposed", "proposal"),
            ("completed", "answer"),
            ("failed", None),
        ]
    ]
